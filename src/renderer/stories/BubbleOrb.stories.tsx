import { BubbleOrb } from "@openbot/ui/features/bubbles/BubbleOrb";
import { BubblePanelHeader } from "@openbot/ui/features/bubbles/BubblePanelHeader";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

// OpenBot Bubbles fork: the collapsed orb in each status, and the expanded panel header.

const ignore = () => undefined;
const chief = { name: "Chief", avatarSeed: "chief", avatarHue: null, avatarUrl: null };
const research = { name: "Research", avatarSeed: "research", avatarHue: null, avatarUrl: null };

const meta = {
  title: "Bubbles/BubbleOrb",
  component: BubbleOrb,
  parameters: { layout: "centered" },
  args: {
    agent: chief,
    status: "idle",
    mood: "idle",
    unreadCount: 0,
    attachedLabel: null,
    onPointerDown: ignore,
    onPointerMove: ignore,
    onPointerUp: ignore,
    onClick: ignore,
  },
} satisfies Meta<typeof BubbleOrb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const Working: Story = { args: { status: "working", mood: "working" } };

export const NeedsAttention: Story = { args: { status: "attention", mood: "waiting" } };

export const Unread: Story = { args: { status: "unread", mood: "responded", unreadCount: 3 } };

export const Attached: Story = {
  args: { status: "working", mood: "working", attachedLabel: "TextEdit — meeting-notes.txt" },
};

export const PanelHeader: StoryObj<typeof BubblePanelHeader> = {
  render: () => (
    <div class="bubble-panel" style={{ width: "380px", height: "120px" }}>
      <BubblePanelHeader
        agent={research}
        mood="idle"
        attachedLabel="Google Chrome — OpenBot docs"
        onCollapse={ignore}
        onOpenMain={ignore}
        onClose={ignore}
      />
    </div>
  ),
};
