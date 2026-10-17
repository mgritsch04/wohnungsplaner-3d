// [USERTEST] (#170) Smart Home simulieren: Melder schaltet Licht – Schritte aus Issue #178.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const panel = (t) => t.page.locator('.panel.left').getByTestId('smarthome-panel');
const device2d = (t, name) => t.page.locator(`[data-testid="device-2d"][data-device="${name}"]`);
const ROOM = 'Wohnzimmer';
const MOTION = `Bewegungsmelder ${ROOM}`;
const LAMP = `Smarte Lampe ${ROOM}`;
const ROOM_CENTER = { x: 2.5, y: 2.0 }; // living room of the sample apartment (5 m × 4 m)

/** Point the 3D view at a device from inside the room, so the device itself is visible. */
async function closeUp3d(t, kind, distance = 1.5) {
  const d = (await t.project()).devices.find((x) => x.kind === kind);
  let dx = ROOM_CENTER.x - d.x;
  let dy = ROOM_CENTER.y - d.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) [dx, dy] = [0.8, 0.6]; // device in the room centre: look from the far corner
  else [dx, dy] = [dx / len, dy / len];
  const target = { x: d.x, y: d.elevation ?? 1, z: d.y };
  await t.lookAt({ x: d.x + dx * distance, y: 1.5, z: d.y + dy * distance }, target);
  await t.page.waitForTimeout(1500);
}

export default {
  issue: 178,
  name: 'Smart Home',
  title: '[USERTEST] (#170) Smart Home simulieren: Melder schaltet Licht',
  device: 'desktop',
  pc: true, // beurteilt Melder und Lichtschein in 3D
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Links den Reiter „Smart Home“ öffnen und unter „Raum“ einen Raum wählen.',
      expected: 'Bereich „Gerät hinzufügen“ ist da, bei „Produkt“ ist „IKEA VALLHORN Bewegungsmelder“ vorausgewählt.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: '2D + 3D' }).click();
        await t.page.locator('.panel.left').getByRole('button', { name: 'Smart Home' }).click();
        await panel(t).getByLabel('Raum').selectOption({ label: ROOM });
        const product = panel(t).getByLabel('Produkt');
        const label = (await product.locator('option:checked').textContent())?.trim();
        const hasAdd = await panel(t).getByText('Gerät hinzufügen').isVisible();
        return {
          status: hasAdd && (await product.inputValue()) === 'ikea-vallhorn' ? 'ok' : 'fail',
          observed: `Raum „${ROOM}“ gewählt. „Gerät hinzufügen“ ${hasAdd ? 'ist da' : 'fehlt'}, „Produkt“ zeigt „${label}“.`,
        };
      },
    },
    {
      nr: 2,
      action: 'Auf „In „…“ platzieren“ klicken.',
      expected: 'In 2D ein lila „B“ in einer Raumecke mit lila Erfassungsfächer (endet an Wänden, geht durch offene Türen). In 3D ein kleines Kästchen an der Wand.',
      async run(t) {
        await panel(t).getByTestId('device-add').click();
        const ok = await t.poll(async () => (await device2d(t, MOTION).count()) === 1);
        const p = await t.project();
        const d = p.devices.find((x) => x.kind === 'motion');
        if (ok) await closeUp3d(t, 'motion');
        return {
          status: ok ? 'look' : 'fail',
          observed: ok
            ? `Melder liegt im Projekt (Position ${d.x.toFixed(2)} m / ${d.y.toFixed(2)} m) und wird in 2D gezeichnet. Ecke, Fächer und Kästchen in 3D bitte am Bild beurteilen.`
            : 'Nach dem Klick ist kein Melder im Plan.',
        };
      },
    },
    {
      nr: 3,
      action: 'Bei „Art“ „Smarte Lampe“ wählen und wieder platzieren.',
      expected: 'Ein „L“ in der Raummitte.',
      async run(t) {
        await panel(t).getByLabel('Art').selectOption({ label: 'Smarte Lampe' });
        await panel(t).getByTestId('device-add').click();
        const ok = await t.poll(async () => (await device2d(t, LAMP).count()) === 1);
        const p = await t.project();
        const lamp = p.devices.find((x) => x.kind === 'light');
        const room = p.rooms.find((r) => r.name === ROOM);
        return {
          status: ok ? 'look' : 'fail',
          observed: ok
            ? `Lampe „${lamp.name}“ platziert bei ${lamp.x.toFixed(2)} / ${lamp.y.toFixed(2)} m${room ? '' : ''}. Lage „Raummitte“ bitte am Bild beurteilen.`
            : 'Nach dem Klick ist keine Lampe im Plan.',
        };
      },
    },
    {
      nr: 4,
      action: 'In der Geräteliste den Bewegungsmelder anklicken.',
      expected: 'Hersteller, Funk (Zigbee), Batterie, Reichweite 5 m, Winkel 120° mit Quellen-Links; bei „Haltezeit“ steht „Annahme“. Blauer Punkt am Melder dreht die Blickrichtung in 2D.',
      async run(t) {
        await panel(t).getByTestId('device-row').filter({ hasText: 'Bewegungsmelder' }).click();
        const det = panel(t).getByTestId('device-details');
        await det.waitFor();
        const text = (await det.innerText()).replace(/\s+/g, ' ');
        const range = await det.getByLabel('Reichweite').inputValue();
        const angle = await det.getByLabel(/Winkel/).inputValue().catch(() => '?');
        const links = await det.locator('a[href^="http"]').count();
        const assumption = await det.getByText('Annahme').count();
        const rotate = await t.page.getByTestId('device-rotate').count();
        const checks = {
          IKEA: /IKEA/.test(text),
          Zigbee: /Zigbee/i.test(text),
          Batterie: /Batterie/i.test(text),
          'Reichweite 5': range === '5',
          'Winkel 120': angle === '120',
          'Quellen-Links': links > 0,
          'Annahme 1×': assumption === 1,
          'Drehpunkt in 2D': rotate > 0,
        };
        const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
        await det.scrollIntoViewIfNeeded();
        return {
          status: missing.length ? 'fail' : 'ok',
          observed: `Reichweite ${range} m, Winkel ${angle}°, ${links} Quellen-Link(s), „Annahme“ ${assumption}×, Drehpunkt in 2D ${rotate ? 'vorhanden' : 'fehlt'}.${missing.length ? ` Fehlt: ${missing.join(', ')}.` : ' Hersteller, Zigbee und Batterie stehen da.'} (Drehen selbst nicht automatisch geprüft.)`,
        };
      },
    },
    {
      nr: 5,
      action: '„Automation anlegen“ klicken, bei „Nur wenn es dunkel ist“ den Haken entfernen.',
      expected: 'Unter „Automationen“ steht „…: Licht bei Bewegung“, die Lampe ist angehakt.',
      async run(t) {
        await panel(t).getByTestId('device-details').getByTestId('automation-add').click();
        const auto = panel(t).getByTestId('automation');
        await auto.first().waitFor();
        const name = await auto.first().getByLabel('Name').inputValue();
        const lampChecked = await auto.getByLabel(new RegExp(LAMP)).isChecked();
        await auto.getByLabel('Nur wenn es dunkel ist').uncheck();
        await auto.first().scrollIntoViewIfNeeded();
        return {
          status: (await auto.count()) === 1 && /Licht bei Bewegung/.test(name) && lampChecked ? 'ok' : 'fail',
          observed: `${await auto.count()} Automation „${name}“. Lampe angehakt: ${lampChecked ? 'ja' : 'nein'}. Haken „Nur wenn es dunkel ist“ entfernt.`,
        };
      },
    },
    {
      nr: 6,
      action: '„Person in den Raum stellen“, „Simulation starten“, dann die orange Person in 2D ein Stück ziehen.',
      expected: 'Melder wird ausgefüllt und meldet „Bewegung“; Lampe geht an (gelber Schein in 2D, Licht in 3D); im Protokoll „Bewegung erkannt“ und „… an“.',
      async run(t) {
        const { page } = t;
        await panel(t).getByTestId('sim-person').click();
        await panel(t).getByTestId('sim-start').click();
        const box = await page.getByTestId('sim-person-2d').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2 + i * 2);
        await page.mouse.up();
        const on = await t.poll(async () => (await device2d(t, LAMP).getAttribute('data-on')) === 'true');
        const motion = await device2d(t, MOTION).getAttribute('data-on');
        const log = (await panel(t).getByTestId('sim-log').innerText().catch(() => '')).replace(/\s+/g, ' ');
        const row = (await panel(t).getByTestId('device-row').filter({ hasText: 'Bewegungsmelder' }).innerText()).replace(/\s+/g, ' ');
        await closeUp3d(t, 'light', 2.6);
        return {
          status: on && motion === 'true' && /Bewegung erkannt/.test(log) && / an/.test(log) ? 'ok' : 'fail',
          observed: `Melder: „${row}“. Lampe an: ${on ? 'ja' : 'nein'}. Protokoll: „${log.slice(0, 140)}“. Gelber Schein und Licht in 3D am Bild.`,
        };
      },
    },
    {
      nr: 7,
      action: 'Person stehen lassen, Tempo „60× schneller“ wählen, etwa 5 Sekunden warten.',
      expected: 'Nach etwa 1 Minute simulierter Zeit meldet der Melder „ruhig“; etwa 2 Minuten später geht die Lampe aus.',
      async run(t) {
        const { page } = t;
        const simT = async () => Number(((await panel(t).getByTestId('sim-clock').innerText()).match(/(\d+) s simuliert/) ?? [])[1]);
        const t0 = await simT();
        await panel(t).getByLabel('Tempo').selectOption({ label: '60× schneller' });
        let quietAt = null;
        let offAt = null;
        const end = Date.now() + 15000;
        while (Date.now() < end && offAt === null) {
          const m = await device2d(t, MOTION).getAttribute('data-on');
          const l = await device2d(t, LAMP).getAttribute('data-on');
          if (quietAt === null && m === 'false') {
            quietAt = (await simT()) - t0;
            await t.shot('Melder meldet „ruhig“, Lampe noch an');
          }
          if (l === 'false') offAt = (await simT()) - t0;
          await page.waitForTimeout(250);
        }
        const plausible = quietAt !== null && offAt !== null && quietAt <= 120 && offAt - quietAt >= 60 && offAt - quietAt <= 240;
        return {
          status: plausible ? 'ok' : 'fail',
          observed: `Melder „ruhig“ nach ${quietAt ?? '–'} s simulierter Zeit, Lampe aus nach ${offAt ?? '–'} s (also ${quietAt !== null && offAt !== null ? offAt - quietAt : '–'} s nach „ruhig“).`,
          caption: 'Lampe wieder aus',
        };
      },
    },
    {
      nr: 8,
      action: 'Optional: statt der Person in 3D „Begehen“ wählen und selbst durch den Raum gehen.',
      expected: 'Du selbst löst den Melder aus.',
      async run() {
        return { status: 'skip', observed: 'Optionaler Schritt, automatisch nicht geprüft.', noFinalShot: true };
      },
    },
    {
      nr: 9,
      action: 'Bei „Abdeckung durch Melder“ nachsehen.',
      expected: 'Für den Raum wird ein Prozentwert angezeigt, für Räume ohne Melder 0 %.',
      async run(t) {
        const rows = panel(t).getByTestId('coverage');
        await rows.first().scrollIntoViewIfNeeded();
        const list = await rows.evaluateAll((els) => els.map((e) => ({ room: e.dataset.room, share: Number(e.dataset.share) })));
        const mine = list.find((r) => r.room === ROOM);
        const others = list.filter((r) => r.room !== ROOM);
        const ok = mine && mine.share > 0 && others.every((r) => r.share === 0);
        return {
          status: ok ? 'ok' : 'fail',
          observed: list.map((r) => `${r.room} ${Math.round(r.share * 100)} %`).join(', '),
        };
      },
    },
    {
      nr: 10,
      action: '„Als Home-Assistant-YAML herunterladen“ klicken.',
      expected: 'Eine Datei „…-automations.yaml“ mit der Automation (Auslöser, Bedingung, Licht an, Warten, Licht aus).',
      async run(t) {
        const download = t.page.waitForEvent('download');
        await panel(t).getByTestId('ha-export').click();
        const file = await download;
        const name = file.suggestedFilename();
        const chunks = [];
        for await (const c of await file.createReadStream()) chunks.push(c);
        const yaml = Buffer.concat(chunks).toString('utf8');
        writeFileSync(join(t.outDir, name), yaml);
        const parts = { Auslöser: /trigger/.test(yaml), 'Licht an': /light\.turn_on/.test(yaml), Warten: /wait_for_trigger|delay/.test(yaml), 'Licht aus': /light\.turn_off/.test(yaml) };
        const missing = Object.entries(parts).filter(([, v]) => !v).map(([k]) => k);
        return {
          status: /-automations\.yaml$/.test(name) && !missing.length ? 'ok' : 'fail',
          observed: `Datei „${name}“ (${yaml.split('\n').length} Zeilen). ${missing.length ? `Fehlt: ${missing.join(', ')}.` : 'Auslöser, Licht an, Warten und Licht aus sind drin.'} Bedingung: ${/condition/.test(yaml) ? 'vorhanden' : 'keine (Haken „dunkel“ war entfernt)'}.`,
        };
      },
    },
    {
      nr: 11,
      action: '„Simulation stoppen“ klicken und die Seite neu laden.',
      expected: 'Geräte und Automation sind noch da; die Lampe ist im Plan wie vor der Simulation.',
      async run(t) {
        const { page } = t;
        await panel(t).getByTestId('sim-stop').click();
        await page.waitForTimeout(1500);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(1200);
        await page.locator('.panel.left').getByRole('button', { name: 'Smart Home' }).click();
        const p = await t.project();
        const lampDev = p.devices.find((d) => d.kind === 'light');
        const light = p.lights.find((l) => l.id === lampDev?.lightId);
        const ok = p.devices.length === 2 && p.automations.length === 1 && light && light.on === false;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Nach dem Neuladen: ${p.devices.length} Geräte, ${p.automations.length} Automation, Lampe im Plan ${light?.on ? 'an' : 'aus'} (wie vor der Simulation).`,
        };
      },
    },
  ],
};
