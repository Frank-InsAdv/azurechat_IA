"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { FC, Suspense, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { DisplayError } from "../ui/error/display-error";
import { PageLoader } from "../ui/page-loader";
import { ScrollArea } from "../ui/scroll-area";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import {
  Table as ShadTable,
  TableBody as ShadTableBody,
  TableCell,
  TableHead as ShadTableHead,
  TableHeader as ShadTableHeader,
  TableRow as ShadTableRow,
} from "../ui/table";
import { ReportingHero } from "./reporting-hero";
import {
  FindAllChatThreadsForAdmin,
  FindWeeklySummariesForAdmin,
  WeeklySummary,
} from "./reporting-services/reporting-service";
import ChatThreadRow from "./table-row";

const SEARCH_PAGE_SIZE = 100;

interface ChatReportingProps {
  page: number;
}

export const ChatReportingPage: FC<ChatReportingProps> = async (props) => {
  return (
    <ScrollArea className="flex-1">
      <main className="flex flex-1 flex-col">
        <ReportingHero />
        <Suspense fallback={<PageLoader />} key={props.page}>
          <ReportingContent {...props} />
        </Suspense>
      </main>
    </ScrollArea>
  );
};

// helper: format "DD-MM-YYYY to DD-MM-YYYY" from ISO weekStart / weekEnd (uses UTC parts)
function formatWeekRange(weekStartISO: string, weekEndISO: string) {
  if (!weekStartISO || !weekEndISO) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  const s = new Date(weekStartISO);
  const e = new Date(weekEndISO);
  const fmt = (d: Date) =>
    `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
  return `${fmt(s)} to ${fmt(e)}`;
}

// ----------------------
// Admin Consent UI (client-side)
// ----------------------
function AdminConsentGenerator() {
  const [tenantId, setTenantId] = useState("");
  const [consentUrl, setConsentUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setError(null);
    setConsentUrl("");
    if (!tenantId.trim()) {
      setError("Please enter a tenant ID (GUID) or 'organizations'.");
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch("/api/auth/generate-admin-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenantId.trim(), expiresIn: "24h" }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || "Failed to generate URL");
      }
      setConsentUrl(data.url);
    } catch (err: any) {
      console.error("generate-admin-consent error:", err);
      setError(err?.message || "Failed to generate URL");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!consentUrl) return;
    try {
      await navigator.clipboard.writeText(consentUrl);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mb-6 p-4 border rounded-md bg-muted">
      <h2 className="text-lg font-semibold mb-2">Generate Admin Consent URL</h2>
      <div className="flex flex-col md:flex-row gap-2 mb-2">
        <Input
          placeholder="Tenant ID (GUID) or 'organizations'"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
        />
        <Button onClick={handleGenerate} disabled={loading}>
          {loading ? "Generating…" : "Generate URL"}
        </Button>
      </div>

      {error && <div className="text-destructive mb-2">{error}</div>}

      {consentUrl && (
        <div className="flex gap-2 items-center">
          <Input
            className="flex-1"
            value={consentUrl}
            readOnly
            onFocus={(e) => (e.target as HTMLInputElement).select()}
          />
          <Button onClick={handleCopy}>Copy</Button>
        </div>
      )}
    </div>
  );
}

// ----------------------
// Reporting content (server-rendered data fetches inside)
// ----------------------
async function ReportingContent(props: ChatReportingProps) {
  let pageNumber = props.page < 0 ? 0 : props.page;
  let nextPage = pageNumber + 1;
  let previousPage = pageNumber - 1;

  const chatHistoryResponse = await FindAllChatThreadsForAdmin(
    SEARCH_PAGE_SIZE,
    props.page * SEARCH_PAGE_SIZE
  );

  if (chatHistoryResponse.status !== "OK") {
    return <DisplayError errors={chatHistoryResponse.errors} />;
  }

  const chatThreads = chatHistoryResponse.response;
  const hasMoreResults = chatThreads.length === SEARCH_PAGE_SIZE;

  // --- fetch weekly summaries from server (last 6 weeks) ---
  const weeklyResponse = await FindWeeklySummariesForAdmin(6);
  let weeklySummaries: WeeklySummary[] = [];
  let weeklyError = null;
  if (weeklyResponse.status === "OK") {
    weeklySummaries = weeklyResponse.response;
  } else {
    weeklyError = weeklyResponse.errors;
    console.error("FindWeeklySummariesForAdmin error:", weeklyError);
  }

  return (
    <div className="container max-w-4xl py-3">
      {/* --- ADMIN CONSENT GENERATOR --- */}
      <AdminConsentGenerator />

      {/* show weekly summary error if present but continue rendering the page */}
      {weeklyError && <DisplayError errors={weeklyError} />}

      {/* --- SUMMARY TABLE --- */}
      <ShadTable className="mb-6">
        <ShadTableHeader>
          <ShadTableRow>
            <ShadTableHead>Week</ShadTableHead>
            <ShadTableHead>Unique Users</ShadTableHead>
            <ShadTableHead>Conversations</ShadTableHead>
          </ShadTableRow>
        </ShadTableHeader>
        <ShadTableBody>
          {weeklySummaries.map((row) => (
            <ShadTableRow key={row.weekStartISO}>
              <TableCell>{formatWeekRange(row.weekStartISO, row.weekEndISO)}</TableCell>
              <TableCell>{row.uniqueUsers}</TableCell>
              <TableCell>{row.conversations}</TableCell>
            </ShadTableRow>
          ))}
        </ShadTableBody>
      </ShadTable>

      {/* EXISTING CHAT THREAD TABLE */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Conversation</TableHead>
            <TableHead className="w-[200px]">User</TableHead>
            <TableHead className="w-[100px]">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {chatThreads.map((chatThread) => (
            <ChatThreadRow key={chatThread.id} {...chatThread} />
          ))}
        </TableBody>
      </Table>

      <div className="flex gap-2 p-2 justify-end">
        {previousPage >= 0 && (
          <Button asChild size={"icon"} variant={"outline"}>
            <Link href={"/reporting?pageNumber=" + previousPage}>
              <ChevronLeft />
            </Link>
          </Button>
        )}
        {hasMoreResults && (
          <Button asChild size={"icon"} variant={"outline"}>
            <Link href={"/reporting?pageNumber=" + nextPage}>
              <ChevronRight />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export default ChatReportingPage;
