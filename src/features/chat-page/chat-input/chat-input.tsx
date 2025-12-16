"use client";

import React, { useRef } from "react";

import {
  ResetInputRows,
  onKeyDown,
  onKeyUp,
  useChatInputDynamicHeight,
} from "@/features/chat-page/chat-input/use-chat-input-dynamic-height";

import { AttachFile } from "@/features/ui/chat/chat-input-area/attach-file";
import {
  ChatInputActionArea,
  ChatInputForm,
  ChatInputPrimaryActionArea,
  ChatInputSecondaryActionArea,
} from "@/features/ui/chat/chat-input-area/chat-input-area";
import { ChatTextInput } from "@/features/ui/chat/chat-input-area/chat-text-input";
import { ImageInput } from "@/features/ui/chat/chat-input-area/image-input";
import { Microphone } from "@/features/ui/chat/chat-input-area/microphone";
import { StopChat } from "@/features/ui/chat/chat-input-area/stop-chat";
import { SubmitChat } from "@/features/ui/chat/chat-input-area/submit-chat";

import { chatStore, useChat } from "../chat-store";
import { fileStore, useFileStore } from "./file/file-store";
import { PromptSlider } from "./prompt/prompt-slider";
import {
  speechToTextStore,
  useSpeechToText,
} from "./speech/use-speech-to-text";
import {
  textToSpeechStore,
  useTextToSpeech,
} from "./speech/use-text-to-speech";

/**
 * Read the latest toggle value directly from localStorage.
 * AgentToggle.tsx persists: localStorage.setItem("ia-agent-toggle", "true" | "false")
 */
function readAgentToggle(): boolean {
  try {
    return window.localStorage.getItem("ia-agent-toggle") === "true";
  } catch {
    return false;
  }
}

export const ChatInput = () => {
  const { loading, input, chatThreadId } = useChat();
  const { uploadButtonLabel } = useFileStore();
  const { isPlaying } = useTextToSpeech();
  const { isMicrophoneReady } = useSpeechToText();
  const { rows } = useChatInputDynamicHeight();

  const submitButton = React.useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = () => {
    if (formRef.current) {
      formRef.current.requestSubmit();
    }
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();

    // 🔽 Ensure hidden fields reflect the *current* toggle and message at submit time
    const form = e.currentTarget as HTMLFormElement;
    const useAgentNow = readAgentToggle();

    const agentFlagInput = form.querySelector<HTMLInputElement>('input[name="__useAgent"]');
    if (agentFlagInput) agentFlagInput.value = useAgentNow ? "true" : "false";

    const messageInput = form.querySelector<HTMLInputElement>('input[name="message"]');
    if (messageInput) messageInput.value = input ?? "";

    const convInput = form.querySelector<HTMLInputElement>('input[name="conversationId"]');
    if (convInput) convInput.value = chatThreadId ?? "";

    // Hand off to the existing store pipeline – it will read __useAgent and switch
    chatStore.submitChat(e);
  };

  return (
    <ChatInputForm
      ref={formRef}
      onSubmit={handleSubmit}
      status={uploadButtonLabel}
    >
      {/* Hidden fields (values will be set right before submit) */}
      <input type="hidden" name="__useAgent" value="false" />
      <input type="hidden" name="message" value="" />
      <input type="hidden" name="conversationId" value="" />

      <ChatTextInput
        onBlur={(e) => {
          if (e.currentTarget.value.replace(/\s/g, "").length === 0) {
            ResetInputRows();
          }
        }}
        onKeyDown={(e) => {
          onKeyDown(e, submit);
        }}
        onKeyUp={(e) => {
          onKeyUp(e);
        }}
        value={input}
        rows={rows}
        onChange={(e) => {
          chatStore.updateInput(e.currentTarget.value);
        }}
      />
      <ChatInputActionArea>
        <ChatInputSecondaryActionArea>
          <AttachFile
            onClick={(formData) =>
              fileStore.onFileChange({ formData, chatThreadId })
            }
          />
          <PromptSlider />
        </ChatInputSecondaryActionArea>
        <ChatInputPrimaryActionArea>
          <ImageInput />
          <Microphone
            startRecognition={() => speechToTextStore.startRecognition()}
            stopRecognition={() => speechToTextStore.stopRecognition()}
            isPlaying={isPlaying}
            stopPlaying={() => textToSpeechStore.stopPlaying()}
            isMicrophoneReady={isMicrophoneReady}
          />
          {loading === "loading" ? (
            <StopChat stop={() => chatStore.stopGeneratingMessages()} />
          ) : (
            <SubmitChat ref={submitButton} />
          )}
        </ChatInputPrimaryActionArea>
      </ChatInputActionArea>
    </ChatInputForm>
  );
};
