// Smart Home: „Gerät hinzufügen“ nimmt den gewählten Raum (#232) – Testschritte aus dem Kommentar in #232.
const left = (t) => t.page.locator('.panel.left');
const panel = (t) => left(t).getByTestId('smarthome-panel');

export default {
  issue: 232,
  name: 'Smart Home: Raumauswahl',
  title: 'Smart Home: Beim „Gerät hinzufügen“ lässt sich scheinbar nur das Bad wählen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Reiter Smart Home, Schritt Geräte.',
      expected: 'Der Schritt „Geräte“ mit „Gerät hinzufügen“ ist sichtbar.',
      async run(t) {
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        const step = await panel(t).getByTestId('sh-step-devices').getAttribute('aria-pressed');
        const rooms = await panel(t).getByLabel('Raum').locator('option').allInnerTexts();
        return { status: step === 'true' && rooms.length >= 2 ? 'ok' : 'fail', observed: `Schritt „Geräte“ aktiv; Räume in der Auswahl: ${rooms.join(', ')}.` };
      },
    },
    {
      nr: 2,
      action: 'Unter „Raum“ einen anderen Raum als den ersten wählen (z. B. Schlafzimmer) und „In „Schlafzimmer“ platzieren“ drücken.',
      expected: 'Das Gerät landet im Schlafzimmer und heißt z. B. „Bewegungsmelder Schlafzimmer“.',
      async run(t) {
        const { page } = t;
        await panel(t).getByLabel('Raum').selectOption({ label: 'Schlafzimmer' });
        const btn = panel(t).getByTestId('device-add');
        const label = (await btn.innerText()).trim();
        await btn.click();
        await page.waitForTimeout(500);
        const devs = (await t.project()).devices;
        const d = devs.at(-1);
        // the bedroom lies to the right of the living room (x > 5.1 in the sample)
        const room = (await t.project()).rooms.find((r) => r.name === 'Schlafzimmer');
        await t.shot('Gerät im Schlafzimmer');
        return { status: devs.length === 1 && /Schlafzimmer/.test(d.name) && /Schlafzimmer/.test(label) && d.x > 5.1 ? 'ok' : 'fail', observed: `Knopf „${label}“; Gerät „${d.name}“ bei (${d.x.toFixed(2)} / ${d.y.toFixed(2)}) m (Schlafzimmer rechts der Trennwand bei x ≈ 5,1 m); Raum im Modell: ${room?.name}.` };
      },
    },
    {
      nr: 3,
      action: 'Im 2D-Plan einen Raum anklicken und zurück in den Smart-Home-Reiter gehen.',
      expected: 'Die Raumauswahl zeigt diesen Raum.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click().catch(() => undefined);
        const living = (await t.project()).rooms.find((r) => r.name === 'Wohnzimmer');
        const s = await t.planToScreen(1.2, 3.2); // free floor in the living room
        await page.mouse.click(s.x, s.y);
        await left(t).getByRole('button', { name: 'Katalog' }).click();
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        const v = await panel(t).getByLabel('Raum').evaluate((el) => el.options[el.selectedIndex].text);
        const sel = await t.selection();
        return { status: /Wohnzimmer/.test(v) ? 'ok' : 'fail', observed: `Im 2D-Plan bei (1,2 / 3,2) m geklickt (Auswahl: ${sel?.type ?? '–'} ${living ? '' : ''}), zurück im Smart-Home-Reiter zeigt die Raumauswahl „${v}“.` };
      },
    },
  ],
};
