import type { HistorianFamily } from "./historianFamilies";

export type HistorianAskInput = {
  question: string;
  seasonYear?: number | null;
};

export type HistorianDataEnvelope<TPayload = unknown> = {
  family: HistorianFamily;
  payload: TPayload;
  notes?: readonly string[];
};

export type HistorianBuildPromptArgs<TPayload = unknown> = {
  input: HistorianAskInput;
  data: HistorianDataEnvelope<TPayload>;
};

export type HistorianHandler<TPayload = unknown> = {
  family: HistorianFamily;
  canHandle(input: HistorianAskInput): boolean | Promise<boolean>;
  getData(input: HistorianAskInput): Promise<HistorianDataEnvelope<TPayload>>;
  buildPrompt(args: HistorianBuildPromptArgs<TPayload>): string;
};