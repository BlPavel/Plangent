import test from 'node:test';
import assert from 'node:assert/strict';
import { repairMojibake } from './encoding';

test('UTF-8 read as Windows-1251 is restored line by line, correct text is left alone', () => {
  const broken = Buffer.from('- [x] (p1) Создать `test.txt` «ок»', 'utf8').toString('latin1');
  const asCp1251 = new TextDecoder('windows-1251').decode(Buffer.from(broken, 'latin1'));
  assert.equal(repairMojibake(`﻿${asCp1251}\n- [ ] (p2) Рабочий Сервер — да`), '- [x] (p1) Создать `test.txt` «ок»\n- [ ] (p2) Рабочий Сервер — да');
  assert.equal(repairMojibake('plain ascii\nСтрока'), 'plain ascii\nСтрока');
});
