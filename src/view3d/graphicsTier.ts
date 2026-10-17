import { create } from 'zustand';
import { usePhoneLayout } from '../ui/phoneLayout';
import { usePerformanceStore } from './performanceStore';

/**
 * Graphics level of realism mode (#192). "high" adds effects that only a strong graphics card
 * (desktop PC) renders smoothly; phones and weak or software renderers stay on "normal".
 * The choice belongs to the device, not to the project, so it is kept in localStorage.
 */
export type GraphicsTierPref = 'auto' | 'high' | 'normal';
export type GraphicsTier = 'high' | 'normal';

const STORAGE_KEY = 'wp.graphicsTier';

export interface DeviceInfo {
  phone: boolean;
  /** Touch as the main input (tablets, phones). */
  coarsePointer: boolean;
  /** WebGL runs in software (SwiftShader, llvmpipe) – no real graphics card. */
  softwareRenderer: boolean;
  /** The frame rate dropped for a sustained time since the page was opened. */
  declined: boolean;
}

/** "auto" picks "high" only on a desktop with a real graphics card that keeps up. */
export function resolveGraphicsTier(pref: GraphicsTierPref, d: DeviceInfo): GraphicsTier {
  if (pref !== 'auto') return pref;
  return d.phone || d.coarsePointer || d.softwareRenderer || d.declined ? 'normal' : 'high';
}

/** What each level changes. "normal" is the realism mode as it was before #192 plus the cheap improvements. */
export interface TierSettings {
  /** Quality of the ambient occlusion (N8AO). */
  aoQuality: 'performance' | 'medium' | 'high';
  /** Time-of-day environment: hours per rebuild step, and the resolution of the reflection map. */
  envStepHours: number;
  envSize: number;
}

export function tierSettings(tier: GraphicsTier): TierSettings {
  return tier === 'high' ? { aoQuality: 'high', envStepHours: 0.25, envSize: 512 } : { aoQuality: 'medium', envStepHours: 0.5, envSize: 256 };
}

function readPref(): GraphicsTierPref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'high' || v === 'normal' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

interface GraphicsTierStore {
  pref: GraphicsTierPref;
  softwareRenderer: boolean;
  setPref: (p: GraphicsTierPref) => void;
  setSoftwareRenderer: (v: boolean) => void;
}

export const useGraphicsTierStore = create<GraphicsTierStore>((set) => ({
  pref: readPref(),
  softwareRenderer: false,
  setPref: (pref) => {
    try {
      if (pref === 'auto') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // private mode: the choice lasts for this page only
    }
    set({ pref });
  },
  setSoftwareRenderer: (softwareRenderer) => set({ softwareRenderer }),
}));

/** Name of the WebGL renderer and whether it is a software one. */
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
}

export function coarsePointer(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
}

/** The level in effect on this device right now. */
export function useGraphicsTier(): GraphicsTier {
  const pref = useGraphicsTierStore((s) => s.pref);
  const softwareRenderer = useGraphicsTierStore((s) => s.softwareRenderer);
  const phone = usePhoneLayout();
  const declined = usePerformanceStore((s) => s.declines > 0);
  return resolveGraphicsTier(pref, { phone, coarsePointer: coarsePointer(), softwareRenderer, declined });
}
