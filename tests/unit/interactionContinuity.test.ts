import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canSelectAccount, findInteractiveAccountId } from '../../src/utils/interactiveAccount';
import {
  classifyMaterialAuthorizationSnapshot,
  decideMaterialAuthorizationProgress,
} from '../../src/utils/materialAuthorization';
import { calculateSidebarSplitRatio, clampSidebarWidth } from '../../src/utils/resizeMath';

describe('视频任务执行连续性', () => {
  it('注入/提交阶段持有唯一前台账号，生成阶段释放交互租约', () => {
    expect(findInteractiveAccountId({ a: 'generating', b: 'injecting' })).toBe('b');
    expect(findInteractiveAccountId({ a: 'generating', b: 'completed' })).toBeNull();
    expect(canSelectAccount('b', 'b')).toBe(true);
    expect(canSelectAccount('a', 'b')).toBe(false);
  });

  it.each([
    [{ title: '', body: '', actions: [] }, 'absent'],
    [{ title: '', body: '普通业务确认', actions: ['拒绝', '确认'] }, 'absent'],
    [{ title: '安全确认', body: '上传、使用的素材均已充分授权', actions: ['拒绝', '确认'] }, 'present'],
    [{ title: '安全确认', body: '上传、使用的素材', actions: ['确认'] }, 'blocked'],
  ] as const)('素材授权弹窗严格分类 %#', (snapshot, expected) => {
    expect(classifyMaterialAuthorizationSnapshot(snapshot)).toBe(expected);
  });

  it('人工确认后只回读同一次提交；弹窗消失但无提交证据时保持不确定', () => {
    expect(decideMaterialAuthorizationProgress({
      dialogState: 'present', submissionConfirmed: false, elapsedMs: 1000, timeoutMs: 60_000,
    })).toBe('waiting');
    expect(decideMaterialAuthorizationProgress({
      dialogState: 'absent', submissionConfirmed: true, elapsedMs: 2000, timeoutMs: 60_000,
    })).toBe('confirmed');
    expect(decideMaterialAuthorizationProgress({
      dialogState: 'absent', submissionConfirmed: false, elapsedMs: 2000, timeoutMs: 60_000,
    })).toBe('uncertain');
  });

  it('分隔条计算有界，拖动期间只移动预览线且不重排真实面板', () => {
    expect(clampSidebarWidth(100)).toBe(280);
    expect(clampSidebarWidth(900)).toBe(500);
    expect(calculateSidebarSplitRatio(50, 0, 1000)).toBe(0.2);
    expect(calculateSidebarSplitRatio(900, 0, 1000)).toBe(0.7);

    const appSource = readFileSync(resolve(__dirname, '..', '..', 'src', 'App.tsx'), 'utf8');
    const sidebarSource = readFileSync(resolve(__dirname, '..', '..', 'src', 'components', 'Sidebar.tsx'), 'utf8');
    expect(appSource).toContain('requestAnimationFrame');
    expect(sidebarSource).toContain('requestAnimationFrame');
    expect(appSource).toContain('resizerRef.current.style.transform');
    expect(sidebarSource).toContain('splitResizerRef.current.style.transform');
    expect(appSource).toContain('resize-capture-overlay-col');
    expect(sidebarSource).toContain('resize-capture-overlay-row');
    expect(appSource).not.toContain('sidebarRef.current.style.width = `${current.pendingWidth}px`');
    expect(sidebarSource).not.toContain('accountPaneRef.current.style.height = `${current.pendingRatio * 100}%`');
  });

  it('账号列表和任务卡跳转都必须经过同一交互账号租约', () => {
    const accountListSource = readFileSync(resolve(__dirname, '..', '..', 'src', 'components', 'AccountList.tsx'), 'utf8');
    const taskConsoleSource = readFileSync(resolve(__dirname, '..', '..', 'src', 'components', 'TaskConsole.tsx'), 'utf8');
    expect(accountListSource).toContain('canSelectAccount(accountId, interactiveAccountId)');
    expect(taskConsoleSource).toContain('canSelectAccount(task.assignedAccountId, interactiveAccountId)');
  });
});
