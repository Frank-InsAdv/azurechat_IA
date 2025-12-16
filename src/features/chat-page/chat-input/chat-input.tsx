"use client";

import React, { useEffect, useRef, useState } from "react";

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
 * Reads the "Use Agent" toggle state from localStorage.
 * AgentToggle.tsx should persist `localStorage.setItem("ia.useAgent", "true" | "false")`.
 */
function useAgentToggleFromLocalStorage() {
  const [useAgent, setUseAgent] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("ia.useAgent");
      setUseAgent(raw === "true");
    } catch {
      setUseAgent(false);
    }
    // Listen for changes if your toggle updates localStorage from another component
    const onStorage = (evt: StorageEvent) => {
      if (evt.key === "ia.useAgent") {
        setUseAgent(evt.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return useAgent;
}

export const ChatInput = () => {
  const { loading, input, chatThreadId } = useChat();
  const { uploadButtonLabel } = useFileStore();
  const { isPlaying } = useTextToSpeech();
  const { isMicrophoneReady } = useSpeechToText();
  const { rows } = useChatInputDynamicHeight();

  // ✅ read toggle from localStorage (no dependency on a custom hook)
  const useAgent = useAgentToggleFromLocalStorage();

  const submitButton = React.useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = () => {
    if (formRef.current) {
      formRef.current.requestSubmit();
    }
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();

    // Ensure the form has the correct endpoint at the moment of submit
    (e.currentTarget as HTMLFormElement).action = useAgent
      ? "/api/agent-chat"
      : "/api/chat";

    // Hand off to the existing store pipeline.
    // If chatStore.submitChat(e) ignores form.action,
    // add the tiny patch shown below to make it read "__useAgent".
    chatStore.submitChat(e);
  };

  return (
    <ChatInputForm
      ref={formRef}
      action={useAgent ? "/api/agent-chat" : "/api/chat"}
      onSubmit={handleSubmit}
      status={uploadButtonLabel}
    >
      {/* Hidden flag for the store to read if it doesn't use form.action */}
      <input type="hidden" name="__useAgent" value={useAgent ? "true" : "false"} />
      {/* Optional: pass the current input explicitly if your store reads FormData */}
      <input type="hidden" name="message" value={input ?? ""} />

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
``
