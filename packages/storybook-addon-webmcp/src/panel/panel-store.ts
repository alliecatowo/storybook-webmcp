/**
 * State plumbing for the read-only diagnostic panel (spec §34).
 *
 * The WebMCP service owns its lifetime and starts at Manager registration,
 * independent of whether the panel ever mounts (spec §24). This module only
 * observes whatever service instance the manager entry hands it, so the
 * panel component never needs to know how the service is constructed and
 * there is no import cycle back into the service module.
 */

import { useSyncExternalStore } from 'react'
import type { PanelState } from '../core/types.js'

/** The subset of the running WebMCP service the panel is allowed to see. */
export interface WebMCPService {
  /** Registers a listener invoked whenever the panel-relevant state changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Returns the current immutable snapshot of panel-relevant state. */
  getState(): PanelState
}

const EMPTY_STATE: PanelState = {
  supported: false,
  active: false,
  story: null,
  tools: [],
  controlsSummary: { editable: 0, hash: null },
  globalsSummary: { editable: 0, hash: null },
  capabilityChanges: 0,
  lastToolChangeAt: null,
  recentCalls: [],
}

let currentService: WebMCPService | null = null
/** Each subscribed React listener, mapped to its live unsubscribe from the current service. */
const serviceUnsubscribes = new Map<() => void, (() => void) | undefined>()

/** Called once by the manager entry with the live service instance (or null on teardown). */
export function setPanelService(service: WebMCPService | null): void {
  currentService = service
  for (const [listener, unsubscribe] of serviceUnsubscribes) {
    unsubscribe?.()
    serviceUnsubscribes.set(listener, service?.subscribe(listener))
    listener()
  }
}

function subscribe(onStoreChange: () => void): () => void {
  serviceUnsubscribes.set(onStoreChange, currentService?.subscribe(onStoreChange))
  return () => {
    serviceUnsubscribes.get(onStoreChange)?.()
    serviceUnsubscribes.delete(onStoreChange)
  }
}

function getSnapshot(): PanelState {
  return currentService ? currentService.getState() : EMPTY_STATE
}

/** Subscribes the panel to the live WebMCP service; safe to call before the service exists. */
export function usePanelState(): PanelState {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_STATE)
}
