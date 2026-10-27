import { AVATAR_HUES } from "@openbot/contracts/ipc";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { useNavigation } from "../../navigation";
import { useAgentActions } from "../agents/agent-actions";
import { useAgents } from "../agents/agents-context";
import { agentsPort } from "../agents/agents-port";

/**
 * A plain chat (OpenBot Bubbles fork): an agent made to talk rather than act. It keeps to its own
 * folder (`access: "workspace"`), has no Computer Use, wears the "Chat" role badge in the sidebar, and
 * is told to answer directly. Any model OpenBot runs works, including local Ollama and LM Studio
 * models through the header model picker, and a chat can pop out as a bubble like any agent.
 */
const CHAT_PURPOSE =
  "A plain chat assistant. Answer the user directly and conversationally. Do not run commands, edit files, browse, or use tools unless the user explicitly asks you to.";

export function useNewChat() {
  const { t } = useText();
  const { createAgentInPlace } = useAgentActions();
  const { agentList } = useAgents();
  const { selectAgent } = useNavigation();
  const [creating, setCreating] = createSignal(false);

  async function createChat(): Promise<void> {
    if (creating()) return;
    setCreating(true);
    try {
      const role = t("bubbles.chatRole");
      const count = agentList().filter((agent) => agent.title === role).length + 1;
      const seed = `chat-${crypto.randomUUID()}`;
      const chat = await createAgentInPlace({
        name: t("bubbles.chatName", { count }),
        purpose: CHAT_PURPOSE,
        avatarSeed: seed,
        avatarHue: AVATAR_HUES[count % AVATAR_HUES.length] ?? null,
      });
      selectAgent(chat.id);
      // The role badge marks it in the sidebar; the narrow access and no Computer Use keep it a chat.
      await agentsPort()
        .agent.updateAgent({ agentId: chat.id, title: role, access: "workspace", computerUse: false })
        .catch(() => undefined);
    } finally {
      setCreating(false);
    }
  }

  return { createChat, creating };
}
