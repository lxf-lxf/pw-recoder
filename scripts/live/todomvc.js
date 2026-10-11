'use strict';

/**
 * TodoMVC（https://demo.playwright.dev/todomvc/）的"用户"驱动脚本。
 * 只负责扮演用户，不参与录制逻辑；选择器写得随意一点没关系，录制器看的是页面事件。
 *
 * 这个构建没有 data-testid，重复元素只有 aria-label（Toggle Todo / Delete / Edit），
 * 且 .destroy 按钮默认 display:none，必须 hover 才出现 —— 正好用来压测选择器策略。
 *
 * 覆盖：新增待办、勾选、筛选切换、双击编辑、删除。
 */
module.exports = async function todomvc(page) {
  const input = page.locator('input.new-todo');
  const items = page.locator('.todo-list li');

  for (const t of ['buy milk', 'walk dog', 'write tests']) {
    await input.fill(t);
    await input.press('Enter');
  }

  // 勾选第 2 项
  await items.nth(1).locator('.toggle').check();

  // 筛选切换
  await page.getByRole('link', { name: 'Completed' }).click();
  await page.getByRole('link', { name: 'Active' }).click();

  // 双击第 1 项编辑标题
  await items.first().locator('label').dblclick();
  const edit = items.first().locator('input.edit');
  await edit.fill('buy oat milk');
  await edit.press('Enter');

  // 切回 All，否则已完成项不渲染
  await page.getByRole('link', { name: 'All' }).click();

  // 删除第 3 项（.destroy 需要先 hover 才可见）
  const third = items.nth(2);
  await third.hover();
  await third.locator('button.destroy').click();
};

/**
 * 可选：录制器会在 --verify 模式下用它取"用户操作后的终态"，
 * 回放同一份脚本后再比一次，确保录下来的动作语义和手操一致
 * （只靠"回放没报错"是证明不了 .nth() 指对了条目的）。
 */
module.exports.snapshot = async function snapshot(page) {
  return page.locator('.todo-list li').evaluateAll((els) =>
    els.map((el) => ({
      title: el.querySelector('label').textContent.trim(),
      completed: el.classList.contains('completed'),
    })));
};
