"use client";

import { FC, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { ChatInput } from "@/features/chat-page/chat-input/chat-input";
import { chatStore, useChat } from "@/features/chat-page/chat-store";
import { ChatLoading } from "@/features/ui/chat/chat-message-area/chat-loading";
import { ChatMessageArea } from "@/features/ui/chat/chat-message-area/chat-message-area";
import ChatMessageContainer from "@/features/ui/chat/chat-message-area/chat-message-container";
import ChatMessageContentArea from "@/features/ui/chat/chat-message-area/chat-message-content";
import { useChatScrollAnchor } from "@/features/ui/chat/chat-message-area/use-chat-scroll-anchor";

import { ExtensionModel } from "../extensions-page/extension-services/models";
import { ChatHeader } from "./chat-header/chat-header";
import {
  ChatDocumentModel,
  ChatMessageModel,
  ChatThreadModel,
} from "./chat-services/models";
import MessageContent from "./message-content";

// Agent toggle
import AgentToggle from "@/features/common/components/AgentToggle";

interface ChatPageProps {
  messages: Array<ChatMessageModel>;
  chatThread: ChatThreadModel;
  chatDocuments: Array<ChatDocumentModel>;
  extensions: Array<ExtensionModel>;
}

export const ChatPage: FC<ChatPageProps> = (props) => {
  const { data: session } = useSession();

  useEffect(() => {
    chatStore.initChatSession({
      chatThread: props.chatThread,
      messages: props.messages,
      userName: session?.user?.name!,
    });
  }, [props.messages, session?.user?.name, props.chatThread]);

  const { messages, loading } = useChat();

  const current = useRef<HTMLDivElement>(null);
  useChatScrollAnchor({ ref: current });

  // Local state from Agent toggle (we'll read this in a later step)
  const [useAgent, setUseAgent] = useState<boolean>(false);

  return (
    <main className="flex flex-1 relative flex-col">
      <ChatHeader
        chatThread={props.chatThread}
        chatDocuments={props.chatDocuments}
        extensions={props.extensions}
      />

      {/* Agent toggle (positioned under header) */}
      <div className="px-4 py-2 border-b border-muted/30">
        <AgentToggle
          onToggle={(enabled) => setUseAgent(enabled)}
          // initialEnabled={true} // optional
          // helperText="Send via Agent (live web) or standard model." // optional
        />
      </div>

      <ChatMessageContainer ref={current}>
        <ChatMessageContentArea>
          {messages.map((message) => {
            return (
              <ChatMessageArea
                key={message.id}
                profileName={message.name}
                role={message.role}
                onCopy={() => {
                  navigator.clipboard.writeText(message.content);
                }}
                profilePicture={
                  message.role === "assistant" ? "/ai-icon.png" : session?.user?.image
                }
              >
                <MessageContent message={message} />
              </ChatMessageArea>
            );
          })}
          {loading === "loading" && <ChatLoading />}
        </ChatMessageContentArea>
      </ChatMessageContainer>

      {/* NOTE:
          We are not changing ChatInput’s props yet.
          After the /api/agent-chat route is added, ChatInput (or the store)
          can read localStorage ("ia-agent-toggle") or shared state to decide path. */}
      <ChatInput />
    </main>
  );
};
