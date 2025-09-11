import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { FC, Suspense } from "react";
import { Button } from "../ui/button";
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
  const fmt = (d: Date) => `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
  return `${fmt(s)} to ${fmt(e)}`;
}

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

  // --- NEW: fetch weekly summaries from server (last 6 weeks) ---
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

      {/* EXISTING TABLE */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Conversation</TableHead>
            <TableHead className="w-[200px]">User</TableHead>
            <TableHead className="w-[100px]">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {chatThreads &&
            chatThreads.map((chatThread) => (
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
