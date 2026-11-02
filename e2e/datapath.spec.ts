import { test, expect, type Page } from '@playwright/test';

const program = `main:
  addiu $t0, $zero, 11
  addiu $t1, $zero, 22
  sw $t1, 0($a0)
  lw $t2, 0($a0)
  mult $t0, $t1
  beq $t0, $t1, done
  j done
done:
  jr $ra`;

async function openSimulator(page: Page) {
  // The CPU runs locally; no account or database writes are needed for this test.
  const user = { studentId: 'test', name: 'Test', section: 'Test', initials: 'T', role: 'student', email: null };
  await page.route('**/api/profile', (route) => route.fulfill({ json: { user } }));
  await page.addInitScript(({ user, program }) => {
    localStorage.setItem('mipslab.token', 'local-ui-test');
    localStorage.setItem('mipslab.user', JSON.stringify(user));
    localStorage.setItem('mipslab.tour.code-run', '1');
    localStorage.setItem('datapath-speed', '0.5');
    localStorage.setItem('mipslab.code', JSON.stringify({
      lang: 'mips', src: { c: '', mips: program }, entry: 'main', args: ['[7]', '', '', ''],
    }));
  }, { user, program });
  await page.goto('/code?mode=run');
  await page.getByRole('tab', { name: 'Datapath', exact: true }).click();
  await page.clock.install();
  await page.clock.runFor(1000); // settle initial argument/source debounce
}

const card = (page: Page, name: string) => page.locator('.dp-val').filter({ has: page.getByText(name, { exact: true }) });
const next = (page: Page) => page.getByRole('toolbar', { name: 'ควบคุมการรัน' }).getByRole('button', { name: 'ถัดไป' }).click();
async function finishStep(page: Page) {
  await next(page);
  await page.clock.runFor(5000);
}

test('all value cards and tooltips retain values until their signals arrive', async ({ page }) => {
  await openSimulator(page);
  await finishStep(page);
  const previous = await page.locator('.dp-val').allTextContents();
  await next(page);
  await expect(page.locator('.dp-val')).toHaveCount(11);
  expect(await page.locator('.dp-val').allTextContents()).toEqual(previous);
  await page.locator('svg g[aria-label="ALU"]').hover();
  await expect(page.getByRole('tooltip')).toContainText('11');
  await expect(page.getByRole('tooltip')).not.toContainText('22');

  await page.clock.runFor(1300);
  await expect(card(page, 'Instruction')).toContainText('addiu $t1, $zero, 22');
  await expect(card(page, 'PC + 4')).toContainText('0x00400008');
  // The PC write-back and ALU path are still carrying the previous step.
  await expect(card(page, 'PC')).toContainText('ถัดไป 0x00400004');
  await expect(card(page, 'ALU')).toContainText('ผลลัพธ์ 11');
  await expect(page.getByRole('tooltip')).not.toContainText('22');

  await page.clock.runFor(1200);
  await expect(card(page, 'ALU')).toContainText('ผลลัพธ์ 22');
  await expect(page.locator('svg g[aria-label="ALU"]')).toContainText('= 22');
  await expect(page.getByRole('tooltip')).toContainText('22');
  // Register reads arrive before the write-back wire completes.
  await expect(card(page, 'Registers')).toContainText('เขียนลง $t0 11');
  await expect(card(page, 'Registers')).not.toContainText('เขียนลง $t1');
  await page.clock.runFor(1500);
  await expect(card(page, 'Registers')).toContainText('เขียนลง $t1 22');
  await expect(card(page, 'PC')).toContainText('ถัดไป 0x00400008');
});

test('memory, HI/LO, branch and mux cards keep their preceding values too', async ({ page }) => {
  await openSimulator(page);
  await finishStep(page);
  await finishStep(page);
  await finishStep(page); // store
  await expect(card(page, 'Data memory')).toContainText('เขียน 7 → 22');
  await next(page); // load
  await page.clock.runFor(2500);
  await expect(card(page, 'Data memory')).toContainText('เขียน 7 → 22');
  await page.clock.runFor(2500);
  await expect(card(page, 'Data memory')).toContainText('อ่านได้ 22');
  await expect(card(page, 'Mux เขียนกลับ')).toContainText('Data memory');

  for (const name of ['HI / LO', 'Branch', 'Mux PC']) {
    const before = await page.locator('.dp-val').allTextContents();
    await next(page);
    expect(await page.locator('.dp-val').allTextContents()).toEqual(before);
    await page.clock.runFor(5000);
    if (name === 'HI / LO') await expect(card(page, name)).toContainText('LO 242');
    if (name === 'Branch') await expect(card(page, name)).toContainText('กระโดด? ไม่');
  }
});

test('rapid Next, replay, speed changes and reset do not expose future values', async ({ page }) => {
  await openSimulator(page);
  await finishStep(page);
  await next(page);
  await page.clock.runFor(1300); // instruction updated, ALU still holds 11
  await next(page); // interrupt with store
  await expect(card(page, 'ALU')).toContainText('ผลลัพธ์ 11');
  await expect(card(page, 'Instruction')).toContainText('addiu $t1, $zero, 22');
  await page.clock.runFor(5000);
  const before = await page.locator('.dp-val').allTextContents();
  await page.getByRole('button', { name: 'เล่นซ้ำ', exact: true }).click();
  expect(await page.locator('.dp-val').allTextContents()).toEqual(before);
  await page.getByRole('radio', { name: '2×', exact: true }).click();
  expect(await page.locator('.dp-val').allTextContents()).toEqual(before);
  await page.clock.runFor(5000);
  await page.locator('.dp').getByRole('button', { name: 'ขยาย', exact: true }).click();
  expect(await page.locator('.dp-val').allTextContents()).toEqual(before);
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await expect(page.locator('.dp-val.idle')).toHaveCount(11);
  await page.clock.runFor(5000);
  await expect(page.locator('.dp-val.idle')).toHaveCount(11);
});

test('reduced motion displays final values immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSimulator(page);
  await next(page);
  await expect(card(page, 'ALU')).toContainText('ผลลัพธ์ 11');
  await next(page);
  await expect(card(page, 'Registers')).toContainText('เขียนลง $t1 22');
  await expect(card(page, 'PC')).toContainText('ถัดไป 0x00400008');
});
