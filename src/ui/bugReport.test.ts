import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { buildBugReport, newIssueUrl, recentErrorMessages, recordError, type ReportInput } from './bugReport';

const input = (patch: Partial<ReportInput> = {}): ReportInput => {
  const project = createSampleProject();
  project.name = 'Wohnung Musterstraße 12';
  project.furniture[0].name = 'Sofa von Oma';
  project.furniture[0].imageUrl = 'data:image/png;base64,' + 'A'.repeat(500);
  return {
    version: '0.1.0 (abc1234)',
    env: { userAgent: 'TestBrowser/1.0', language: 'de-AT', screen: '1920 × 1080', viewport: '1400 × 900', pixelRatio: 1, webgl: true, online: true },
    project,
    state: { viewMode: 'split', cameraMode: 'orbit', tool: 'select', selection: 'nichts', saveState: 'gespeichert' },
    errors: [],
    ...patch,
  };
};

describe('bug report (#62)', () => {
  it('contains browser, screen, version and app state but no project contents by default', () => {
    const r = buildBugReport(input());
    for (const s of ['0.1.0 (abc1234)', 'TestBrowser/1.0', '1920 × 1080', '1400 × 900', 'Ansicht: split', 'Speichern: gespeichert', 'Räume', 'Möbel/Geräte']) expect(r).toContain(s);
    expect(r).not.toContain('Musterstraße');
    expect(r).not.toContain('Sofa von Oma');
    expect(r).toContain('- keine');
  });

  it('appends the project only on request, without embedded data URLs', () => {
    const r = buildBugReport(input({ includeProject: true, description: 'Sofa springt' }));
    expect(r).toContain('Sofa springt');
    expect(r).toContain('Sofa von Oma');
    expect(r).not.toContain('AAAAAAAAAA');
    expect(r).toMatch(/\[data-URL, \d+ Zeichen\]/);
  });

  it('keeps only the last five errors, shortened', () => {
    for (let i = 0; i < 8; i++) recordError(`Fehler ${i} ${'x'.repeat(400)}`);
    const errs = recentErrorMessages();
    expect(errs).toHaveLength(5);
    expect(errs[0]).toContain('Fehler 3');
    expect(errs.every((e) => e.length <= 310)).toBe(true);
    expect(buildBugReport(input({ errors: errs }))).toContain('Fehler 7');
  });

  it('prefills the issue only while the link stays short', () => {
    const short = newIssueUrl('Problem: x', 'kurz');
    expect(short.bodyIncluded).toBe(true);
    expect(short.url).toContain('body=kurz');
    const long = newIssueUrl('Problem: x', 'y'.repeat(10000));
    expect(long.bodyIncluded).toBe(false);
    expect(long.url).not.toContain('body=');
  });
});
