import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { BotsListResult, cursorSidebarRpcContract } from "./server";

/** bots-sidebar publishes on its own channel, which another plugin cannot hear, so the list polls while the window is visible (the Bots tab badge reads it too). */
const POLL_MS = 15_000;
/** A new or removed thread is the usual sign a binding changed; re-read soon after. */
const THREAD_CHANGE_DEBOUNCE_MS = 500;

export type BotsState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string | null }
  | ({ status: "ready" } & Omit<BotsListResult, "available" | "reason">);

/**
 * bots-sidebar's bot list, read through this plugin's server proxy. `threadKey`
 * is any string that changes when the visible thread set changes; a change
 * triggers a debounced re-read so a conversation created elsewhere joins its
 * bot without waiting for the poll.
 */
export function useBots(threadKey: string): BotsState & { refresh: () => Promise<void> } {
  const rpc = useRpc<typeof cursorSidebarRpcContract>();
  const realtimeState = useRealtimeConnectionState();
  const [state, setState] = useState<BotsState>({ status: "loading" });
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const result = await rpc.call("botsList", {});
      if (mine !== generation.current) return;
      if (!result.available) {
        setState({ status: "unavailable", reason: result.reason });
        return;
      }
      setState({
        status: "ready",
        bots: result.bots,
        threadBindings: result.threadBindings,
        personalProjectId: result.personalProjectId,
        projectOwners: result.projectOwners,
      });
    } catch (cause) {
      if (mine !== generation.current) return;
      // Our own server failed; keep the last good list rather than blanking it.
      setState((current) =>
        current.status === "ready"
          ? current
          : { status: "unavailable", reason: cause instanceof Error ? cause.message : String(cause) },
      );
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh, realtimeState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    const timer = window.setTimeout(() => void refresh(), THREAD_CHANGE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [refresh, threadKey]);

  return useMemo(() => ({ ...state, refresh }), [refresh, state]);
}

export type BotAvatarMarkup = Record<string, { idle: string; working: string }>;

/** bots-sidebar's own avatar SVGs, re-read only when a bot's appearance changes. */
export function useBotAvatars(appearanceKey: string, size: number): BotAvatarMarkup {
  const rpc = useRpc<typeof cursorSidebarRpcContract>();
  const [avatars, setAvatars] = useState<BotAvatarMarkup>({});
  useEffect(() => {
    let cancelled = false;
    void rpc.call("botsAvatars", { size }).then(
      (result) => { if (!cancelled) setAvatars(result.avatars); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [rpc, appearanceKey, size]);
  return avatars;
}
