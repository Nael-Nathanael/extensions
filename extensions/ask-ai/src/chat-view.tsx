import { Action, ActionPanel, Detail, Icon, useNavigation } from "@vicinae/api";
import { useEffect, useState } from "react";
import { type RichAction, renderAnswer } from "./openui.ts";
import { providerById } from "./providers/index.ts";
import { ask, startNew, stop, useConversation } from "./session.ts";
import { type Settings, loadSettings } from "./settings.ts";
import { SettingsForm } from "./settings-form.tsx";
import type { Conversation, Turn } from "./store.ts";
import { WidgetForm } from "./widget-form.tsx";

export function lastCodeBlock(markdown: string): string | undefined {
	const blocks = [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
	return blocks.at(-1)?.[1].replace(/\n$/, "");
}

export function turnMarkdown(turn: Turn, isLatest = false): string {
	const answer = renderAnswer(turn.answer).markdown;
	const body =
		turn.status === "error"
			? `${answer ? `${answer}\n\n\n---\n\n---\n\n\n` : ""}**Couldn't get an answer.**\n\n${turn.error}\n\n_Press Ctrl+R to ask again._`
			: turn.status === "stopped"
				? `${answer ? `${answer}\n\n` : ""}_Stopped._`
				: answer || "_Thinking…_";
	const marker = isLatest ? "💬 Q: " : "Q: ";
	return `### ${marker}${turn.question}\n\n[ ${providerById(turn.providerId).title} ]\n\n${body}`;
}

/** Newest turn first so a streaming answer stays in view; earlier turns follow, newest to oldest. */
export function conversationMarkdown(conv: Conversation, newestFirst: boolean): string {
	const turns = newestFirst ? [...conv.turns].reverse() : conv.turns;
	const latestId = conv.turns.at(-1)?.id;
	return turns.map((t) => turnMarkdown(t, t.id === latestId)).join("\n\n\n---\n\n---\n\n\n");
}

export const transcriptText = (conv: Conversation) =>
	conv.turns.map((t) => `Q: ${t.question}\n\nA: ${renderAnswer(t.answer).markdown}`).join("\n\n---\n\n");

function richAction(action: RichAction, i: number) {
	switch (action.kind) {
		case "open":
			return <Action.OpenInBrowser key={i} title={action.label} url={action.url} />;
		case "copy":
			return <Action.CopyToClipboard key={i} title={action.label} content={action.text} />;
		case "ask":
			return <Action key={i} title={`Ask: ${action.question}`} icon={Icon.SpeechBubble} onAction={() => ask(action.question)} />;
	}
}

/** The full-width answer view. Esc (or Ask Follow-up) returns to the search bar for the next question. */
export function ChatView() {
	const { pop, push } = useNavigation();
	const conv = useConversation();
	const [settings, setSettings] = useState<Settings | null>(null);
	useEffect(() => { loadSettings().then(setSettings); }, []);
	const viewMode = settings?.viewMode ?? "stacked";

	const latest = conv.turns.at(-1);
	const streaming = latest?.status === "streaming";
	const { markdown: answer, actions: rich, widgets } = renderAnswer(latest?.answer ?? "");
	const code = lastCodeBlock(answer);

	// Thinking animation: rotate dots while waiting for the first token.
	const [dots, setDots] = useState(0);
	const thinking = streaming && !answer;
	useEffect(() => {
		if (!thinking) return;
		const t = setInterval(() => setDots((d) => (d + 1) % 4), 150);
		return () => clearInterval(t);
	}, [thinking]);
	const thinkingText = "_Thinking" + ".".repeat(dots + 1) + "_";

	// Paginated view state (newest first).
	const reversed = [...conv.turns].reverse();
	const [idx, setIdx] = useState(0);
	useEffect(() => { setIdx(0); }, [conv.turns.length, latest?.id]);
	const safeIdx = Math.min(idx, Math.max(0, reversed.length - 1));
	const currentTurn = reversed[safeIdx];

	const stackedMd = conversationMarkdown(conv, true).replace("_Thinking…_", thinking ? thinkingText : "_Thinking…_");
	const paginatedBase = currentTurn ? turnMarkdown(currentTurn, currentTurn.id === latest?.id) : stackedMd;
	const paginatedMd = viewMode === "paginated" && currentTurn?.id === latest?.id && thinking
		? paginatedBase.replace("_Thinking…_", thinkingText)
		: paginatedBase;
	const markdown = viewMode === "paginated" ? paginatedMd : stackedMd;

	return (
		<Detail
			navigationTitle={viewMode === "paginated" && reversed.length > 1 ? `${conv.title || "Ask AI"}  (${safeIdx + 1}/${reversed.length})` : (conv.title || "Ask AI")}
			markdown={markdown}
			actions={
				<ActionPanel>
					<Action.CopyToClipboard
						title="Copy Answer"
						content={answer}
						shortcut={{ modifiers: ["ctrl"], key: "c" }}
					/>
					<Action title="Ask Follow-up" icon={Icon.SpeechBubble} shortcut={{ modifiers: ["ctrl"], key: "l" }} onAction={pop} />
					{viewMode === "paginated" && reversed.length > 1 && (
						<ActionPanel.Section title="Navigate">
							{safeIdx < reversed.length - 1 && (
								<Action
									title="Previous question"
									icon={Icon.ArrowLeft}
									shortcut={{ modifiers: ["ctrl"], key: "[" }}
									onAction={() => setIdx(safeIdx + 1)}
								/>
							)}
							{safeIdx > 0 && (
								<Action
									title="Next question"
									icon={Icon.ArrowRight}
									shortcut={{ modifiers: ["ctrl"], key: "]" }}
									onAction={() => setIdx(safeIdx - 1)}
								/>
							)}
						</ActionPanel.Section>
					)}
					{!streaming && (widgets.length > 0 || rich.length > 0) && (
						<ActionPanel.Section title="From the Answer">
							{widgets.map((w, i) => (
								<Action
									key={`w${i}`}
									title={`Open ${w.title}`}
									icon={Icon.Calculator}
									shortcut={i === 0 ? { modifiers: ["ctrl"], key: "o" } : undefined}
									onAction={() => push(<WidgetForm widget={w} />)}
								/>
							))}
							{rich.map(richAction)}
						</ActionPanel.Section>
					)}
					<Action.Paste title="Paste Answer" content={answer} />
					{code !== undefined && (
						<Action.CopyToClipboard
							title="Copy Last Code Block"
							content={code}
							shortcut={{ modifiers: ["ctrl", "shift"], key: "k" }}
						/>
					)}
					<Action.CopyToClipboard
						title="Copy Conversation"
						content={transcriptText(conv)}
						shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
					/>
					{streaming ? (
						<Action title="Stop" icon={Icon.Stop} shortcut={{ modifiers: ["ctrl"], key: "." }} onAction={stop} />
					) : (
						latest && (
							<Action
								title="Ask Again"
								icon={Icon.ArrowClockwise}
								shortcut={{ modifiers: ["ctrl"], key: "r" }}
								onAction={() => ask(latest.question)}
							/>
						)
					)}
					<Action
						title="New Conversation"
						icon={Icon.Plus}
						shortcut="new"
						onAction={() => {
							startNew();
							pop();
						}}
					/>
					<Action
						title="Settings"
						icon={Icon.Cog}
						shortcut={{ modifiers: ["ctrl"], key: "," }}
						onAction={() => push(<SettingsForm />)}
					/>
				</ActionPanel>
			}
		/>
	);
}
