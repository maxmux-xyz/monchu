import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { SessionInput } from "../../api/directories.ts";

export const Subthreads = defineExtension({
  name: "monchu.subthreads",
  tools: [
    defineTool({
      name: "propose_subthread",
      description:
        "Head agents only. Show an inline Branch this work into a subthread card for human review. Provide a name, first prompt (brief), directory type, role and an owned directory path (an existing directory or a new folder in an existing parent). Prefer this for proposed handoffs. It opens nothing until the human approves.",
      parameters: SessionInput,
      replay: "safe",
      execute: async () => ({
        output: [{ type: "text", text: "Subthread proposal ready for human review." }],
      }),
    }),
  ],
});
