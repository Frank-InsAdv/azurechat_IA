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

/** Reads the Agent toggle persisted by AgentToggle.tsx */
function useAgentToggleFromLocalStorage(storageKey: string = "ia-agent-toggle") {
  const [useAgent, setUseAgent] = useState(false);

  useEffect(() => {
    // initial read
    try {
      const raw = window.localStorage.getItem(storageKey);
      setUseAgent(raw === "true");
    } catch {
      setUseAgent(false);
    }
    // listen for changes (if toggle flips while component is mounted)
    const onStorage = (evt: StorageEvent) => {
      if (evt.key === storageKey) setUseAgent(evt.newValue === "true");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  return useAgent;
}

export const ChatInput = () => {
  const { loading, input, chatThreadId } = useChat();
  const { uploadButtonLabel } = useFileStore();
  const { isPlaying } = useTextToSpeech();
  const { isMicrophoneReady } = useSpeechToText();
  const { rows } = useChatInputDynamicHeight();

  // ✅ Read "Use Agent (Web Search)" ON/OFF
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
    // Let the store handle the request. It will read the hidden fields.
    chatStore.submitChat(e);
  };

  return (
    <ChatInputForm
      ref={formRef}
      onSubmit={handleSubmit}
      status={uploadButtonLabel}
    >
      {/* Hidden flags for the store */}
      <input type="hidden" name="__useAgent" value={useAgent ? "true" : "false"} />
      <input type="hidden" name="message" value={input ?? ""} />
      <input type="hidden" name="conversationId" value={chatThreadId ?? ""} />

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
