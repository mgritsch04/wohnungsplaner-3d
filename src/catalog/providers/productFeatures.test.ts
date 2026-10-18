import { describe, expect, it } from 'vitest';
import { featuresFromText } from './productFeatures';
import { pageToCatalogEntry } from './ikeaList';
import { parseProductPage } from './structuredData';

// SYNTHETIC page texts in the style of a furniture shop's data table (not copied from a real page)
describe('Formdetails aus dem Seitentext (#273, Stufe 3)', () => {
  it('liest Gestellart, Farben und Teilmaße', () => {
    const text = 'Produktdetails\nFarbe Tischplatte\tEiche Dekor\nFarbe Gestell\tSchwarz\nGestell: Kufengestell aus Metall\nPlattenstärke: 2,5 cm\nBeinstärke 8 x 8 cm\n\nDas könnte dir auch gefallen: Tisch mit X-Gestell';
    expect(featuresFromText(text)).toEqual({ base: 'sled', color: '#c49a6c', secondaryColor: '#1f1f1f', topThickness: 2.5, legSize: 8 });
  });

  it('weitere Gestellarten, runde Tische, Sitzhöhe und mm', () => {
    expect(featuresFromText('Säulenfuß aus Stahl').base).toBe('pedestal');
    expect(featuresFromText('mit X-Gestell').base).toBe('x');
    expect(featuresFromText('Wangengestell in Weiß').base).toBe('panel');
    expect(featuresFromText('Form: rund').round).toBe(true);
    expect(featuresFromText('', 'Esstisch Rund Lio').round).toBe(true);
    expect(featuresFromText('Sitzhöhe: 47 cm Materialstärke Tischplatte: 18 mm')).toMatchObject({ seatHeight: 47, topThickness: 1.8 });
  });

  it('erfindet nichts: ohne Angaben leer, unplausible Werte verworfen', () => {
    expect(featuresFromText('Ein schöner Tisch für die ganze Familie.')).toEqual({});
    expect(featuresFromText('Plattenstärke: 40 cm').topThickness).toBeUndefined();
  });

  it('kommt über die Seite bis in den Katalogeintrag', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'TESTTISCH Synthetisch', offers: { price: '199', priceCurrency: 'EUR' } })}</script></head><body><h1>TESTTISCH Synthetisch</h1><p>Esstisch</p><p>Breite: 160 cm Tiefe: 90 cm Höhe: 76 cm</p><p>Gestell: X-Gestell</p><p>Farbe Gestell: Schwarz</p><p>Plattenstärke: 3 cm</p></body></html>`;
    const e = pageToCatalogEntry(parseProductPage(html, 'https://www.moebelix.at/p/testtisch-001'))!;
    expect(e).toMatchObject({ shape: 'table', base: 'x', secondaryColor: '#1f1f1f', topThickness: 3 });
  });
});
