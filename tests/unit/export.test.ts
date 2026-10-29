import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { csvCell, toCSV, toXLSX } from '../../src/core/export';
import type { User } from '../../src/core/types';

const users: User[] = Array.from({ length: 160 }, (_, i) => ({ id: String(i), username: `usuario${i}`, fullName: i === 0 ? '=HYPERLINK("https://malicioso")' : `Lucía ${i} & "amigos"`, avatar: '', isPrivate: false, isVerified: true }));
describe('exportación íntegra y segura', () => {
  it('CSV exporta más de 50 filas y añade BOM para Excel', () => {
    const csv = toCSV(users);
    expect(csv.charCodeAt(0)).toBe(0xfeff); expect(csv.split('\r\n')).toHaveLength(161);
    expect(csv).toContain('usuario159');
  });
  it('escapa comillas, saltos de línea y separadores', () => {
    expect(csvCell('a;"b"\nc')).toBe('"a;""b""\nc"');
  });
  it.each(['=SUM(1)', '+1', '-1', '@algo', '  =cmd', '\tcomando', '\rcomando'])('neutraliza fórmulas: %s', value => {
    expect(csvCell(value)).toBe(`"'${value}"`);
  });
  it('no altera los nombres normales', () => {
    expect(csvCell('Lucía Martín')).toBe('"Lucía Martín"');
  });
  it('XLSX es un ZIP OpenXML con todas las filas y sin fórmulas', () => {
    const archive = unzipSync(toXLSX(users));
    expect(Object.keys(archive)).toContain('[Content_Types].xml');
    const sheet = strFromU8(archive['xl/worksheets/sheet1.xml']);
    expect(sheet.match(/<row /g)).toHaveLength(161); expect(sheet).toContain('usuario159');
    expect(sheet).not.toContain('<f>'); expect(sheet).toContain('t="inlineStr"'); expect(sheet).toContain('&amp;');
  });
});
