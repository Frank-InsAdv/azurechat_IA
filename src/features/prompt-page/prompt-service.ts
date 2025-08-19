"use server";

import {
  ServerActionResponse,
  zodErrorsToServerActionErrors,
} from "@/features/common/server-action-response";
import {
  PROMPT_ATTRIBUTE,
  PromptModel,
  PromptModelSchema,
} from "@/features/prompt-page/models";
import { SqlQuerySpec } from "@azure/cosmos";
import { getCurrentUser, userHashedId } from "../auth-page/helpers";
import { ConfigContainer } from "../common/services/cosmos";
import { uniqueId } from "../common/util";

export const CreatePrompt = async (
  props: PromptModel
): Promise<ServerActionResponse<PromptModel>> => {
  try {
    const user = await getCurrentUser();

    // 🔹 CHANGE 1: Removed hard "admin only" block
    // Previously: if (!user.isAdmin) { return UNAUTHORIZED }
    // Now: allow everyone to create prompts

    const modelToSave: PromptModel = {
      id: uniqueId(),
      name: props.name,
      description: props.description,

      // 🔹 CHANGE 2: Only admins can set public prompts
      // Regular users always create private ones
      isPublished: user.isAdmin ? props.isPublished : false,

      userId: await userHashedId(),
      createdAt: new Date(),
      type: "PROMPT",
    };

    const valid = ValidateSchema(modelToSave);

    if (valid.status !== "OK") {
      return valid;
    }

    const { resource } = await ConfigContainer().items.create<PromptModel>(
      modelToSave
    );

    if (resource) {
      return {
        status: "OK",
        response: resource,
      };
    } else {
      return {
        status: "ERROR",
        errors: [
          {
            message: "Error creating prompt",
          },
        ],
      };
    }
  } catch (error) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Error creating prompt: ${error}`,
        },
      ],
    };
  }
};

export const FindAllPrompts = async (): Promise<
  ServerActionResponse<Array<PromptModel>>
> => {
  try {
    const user = await getCurrentUser();

    const querySpec: SqlQuerySpec = {
      query: `
        SELECT * FROM root r 
        WHERE r.type=@type 
        AND (
          r.isPublished = true 
          OR r.userId = @userId   -- 🔹 CHANGE 3: show user their own private prompts
        )`,
      parameters: [
        { name: "@type", value: PROMPT_ATTRIBUTE },
        { name: "@userId", value: await userHashedId() },
      ],
    };

    const { resources } = await ConfigContainer()
      .items.query<PromptModel>(querySpec)
      .fetchAll();

    return {
      status: "OK",
      response: resources,
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Error retrieving prompt: ${error}`,
        },
      ],
    };
  }
};

export const EnsurePromptOperation = async (
  promptId: string
): Promise<ServerActionResponse<PromptModel>> => {
  const promptResponse = await FindPromptByID(promptId);
  const currentUser = await getCurrentUser();

  if (promptResponse.status === "OK") {
    const prompt = promptResponse.response;

    // 🔹 CHANGE 4: Allow owner (or admin) to manage their own prompt
    if (currentUser.isAdmin || prompt.userId === await userHashedId()) {
      return promptResponse;
    }
  }

  return {
    status: "UNAUTHORIZED",
    errors: [
      {
        message: `Prompt not found with id: ${promptId}`,
      },
    ],
  };
};
