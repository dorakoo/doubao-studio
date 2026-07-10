/**
 * src/components/BrowserPanel.tsx
 * 内嵌浏览器面板 — V4 正式版
 *
 * 架构：
 * - 每个账号独立 webview，CSS 显隐控制，切换不销毁
 * - 支持多账号并行自动化 + 同账号任务队列
 * - per-account 执行状态监听，自动路由任务到对应 webview
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { message, Switch, Tooltip } from 'antd';
import type { Account, Task, TaskUpdateInput } from '../types';
import { useAccountStore } from '../store/useAccountStore';
import { useTaskStore } from '../store/useTaskStore';
import type { AutomationState } from '../store/useTaskStore';
import { classifyTaskError } from '../utils/taskRuntime';
import {
  injectPrompt,
  submitPrompt,
  checkGeneratingDetailed,
  getResultUrl,
  switchMode,
  waitForChatReady,
  clickAITab,
  configureVideoOptions,
  uploadReferenceImages,
  uploadReferenceAudio,
  inject15sVideoPatch,
  set15sVideoPatchEnabled,
  resetVideoCaptureCache,
  detectVideoGenerationBlocker,
  injectGenerationMonitor,
  getCachedVideoUrl,
  getVideoPlayUrl,
  startNewConversation,
  detectRobotVerification,
} from '../utils/doubaoBridge';

interface BrowserPanelProps {
  accounts: Account[];
  activeAccount: Account | null;
  refreshKey: number;
}

const BrowserPanel: React.FC<BrowserPanelProps> = ({
  accounts,
  activeAccount,
  refreshKey,
}) => {
  const poolRef = useRef<HTMLDivElement>(null);
  const registryRef = useRef<Map<string, HTMLWebViewElement>>(new Map());
  const loadingMapRef = useRef<Map<string, boolean>>(new Map());
  const runningRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const pendingRestartTasksRef = useRef<Map<string, TaskUpdateInput>>(new Map());
  const manual15sRef = useRef<Record<string, boolean>>({});

  const [activeLoading, setActiveLoading] = useState(true);
  const [loadText, setLoadText] = useState('加载豆包中...');
  const [manual15sByAccount, setManual15sByAccount] = useState<Record<string, boolean>>({});

  const accountBusy = useTaskStore((s) => s.accountBusy);
  const accountAutoState = useTaskStore((s) => s.accountAutomationState);
  const accountAutoMsg = useTaskStore((s) => s.accountAutoMessage);
  const executingTasks = useTaskStore((s) => s.executingTasks);
  const tasks = useTaskStore((s) => s.tasks);

  const normalizeVideoUrls = (urls: string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of urls) {
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed || !/^https?:\/\//i.test(trimmed)) continue;
      const lower = trimmed.toLowerCase();
      const isImageOnly = /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(lower) || lower.includes('image') || lower.includes('poster');
      const isLikelyVideo =
        /\.(mp4|mov|m4v|webm|m3u8)(\?|#|$)/i.test(lower) ||
        lower.includes('video') ||
        lower.includes('vod') ||
        lower.includes('play') ||
        lower.includes('mime_type=video') ||
        lower.includes('lr=');
      if (isImageOnly && !isLikelyVideo) continue;
      if (!isLikelyVideo) continue;
      const clean = trimmed.includes('lr=')
        ? trimmed.replace(/lr=[^&]+/g, 'lr=video_gen_no_watermark')
        : trimmed;
      if (!seen.has(clean)) {
        seen.add(clean);
        result.push(clean);
      }
    }
    return result;
  };

  const extractVideoOutputs = async (webview: HTMLWebViewElement): Promise<string[]> => {
    const cached = await getCachedVideoUrl(webview);
    if (cached) {
      // 先用 vid 重新请求播放信息，优先拿豆包明确返回的原始媒体地址。
      const playUrl = await getVideoPlayUrl(webview, cached.vid);
      if (playUrl) {
        const playUrls = normalizeVideoUrls([playUrl]);
        if (playUrls.length > 0) return playUrls;
      }
      if (cached.videoUrl) {
        const cachedUrls = normalizeVideoUrls([cached.videoUrl]);
        if (cachedUrls.length > 0) return cachedUrls;
      }
    }

    const rawResult = await getResultUrl(webview);
    let urls: string[] = [];
    try {
      const parsed = JSON.parse(rawResult);
      urls = Array.isArray(parsed) ? parsed : [];
    } catch {
      urls = rawResult ? [rawResult] : [];
    }
    return normalizeVideoUrls(urls);
  };

  const activeAutoState: AutomationState | undefined = activeAccount
    ? accountAutoState[activeAccount.id]
    : undefined;
  const activeAutoMsg = activeAccount ? (accountAutoMsg[activeAccount.id] || '') : '';

  // ---- webview 池动态管理（账号增删同步） ----
  const accountsKey = accounts.map(a => a.id).join(',');
  useEffect(() => {
    const container = poolRef.current;
    if (!container || !activeAccount) return;

    const accountIds = new Set(accounts.map(a => a.id));

    // 清理已删除账号的 webview
    registryRef.current.forEach((webview, accountId) => {
      if (!accountIds.has(accountId)) {
        container.removeChild(webview);
        registryRef.current.delete(accountId);
        loadingMapRef.current.delete(accountId);
        console.log(`[BrowserPanel] 已移除账号 ${accountId} 的 webview`);
      }
    });

    // 为新增账号创建 webview
    accounts.forEach((account) => {
      createWebview(account, container);
    });

    // 确保当前活跃账号的加载状态同步
    if (activeAccount) {
      const isLoading = loadingMapRef.current.get(activeAccount.id);
      setActiveLoading(!!isLoading);
      if (!isLoading) setLoadText('');
      console.log(`[BrowserPanel] webview 池同步完成 (当前 ${registryRef.current.size} 个), activeAccount=${activeAccount.id}, isLoading=${isLoading}`);
    } else {
      console.log(`[BrowserPanel] webview 池同步完成 (当前 ${registryRef.current.size} 个), 无活跃账号`);
    }
  }, [accountsKey, refreshKey, activeAccount?.id]);

  // ---- 创建单个 webview ----
  const createWebview = (account: Account, container: HTMLDivElement) => {
    if (registryRef.current.has(account.id)) return;

    const accId = account.id;
    loadingMapRef.current.set(accId, true);

    const webview = document.createElement('webview') as HTMLWebViewElement;
    webview.setAttribute('src', 'https://www.doubao.com/chat/');
    webview.setAttribute('partition', `persist:doubao_${account.partition}`);
    webview.setAttribute('allowpopups', 'true');
    webview.style.cssText = 'width:100%;height:100%;border:none;position:absolute;top:0;left:0;';
    webview.style.visibility = 'hidden';
    webview.style.pointerEvents = 'none';

    // 统一加载完成处理
    const markLoaded = (evt: string) => {
      if (!loadingMapRef.current.get(accId)) return; // 已标记完成，不重复处理
      loadingMapRef.current.set(accId, false);
      console.log(`[BrowserPanel] markLoaded: ${accId} via ${evt}`);
      const cur = useAccountStore.getState().selectedAccountId;
      if (accId === cur) {
        setActiveLoading(false);
        setLoadText('');
      }
    };

    webview.addEventListener('did-start-loading', () => {
      loadingMapRef.current.set(accId, true);
      const cur = useAccountStore.getState().selectedAccountId;
      if (accId === cur) {
        setActiveLoading(true);
        setLoadText('页面加载中...');
      }
    });

    webview.addEventListener('did-finish-load', () => markLoaded('did-finish-load'));
    webview.addEventListener('did-stop-loading', () => markLoaded('did-stop-loading'));
    webview.addEventListener('did-navigate', () => markLoaded('did-navigate'));
    webview.addEventListener('did-navigate-in-page', () => markLoaded('did-navigate-in-page'));
    webview.addEventListener('dom-ready', () => {
      markLoaded('dom-ready');
      if (manual15sRef.current[accId]) {
        void inject15sVideoPatch(webview).then(() => set15sVideoPatchEnabled(webview, true));
      }
    });
    webview.addEventListener('did-fail-load', () => {
      loadingMapRef.current.set(accId, false);
      const cur = useAccountStore.getState().selectedAccountId;
      if (accId === cur) {
        setActiveLoading(false);
        setLoadText('加载失败');
      }
    });

    container.appendChild(webview);
    registryRef.current.set(accId, webview);
    console.log(`[BrowserPanel] webview 已创建: ${accId}, src=${webview.getAttribute('src')}, partition=${webview.getAttribute('partition')}, inDOM=${container.contains(webview)}`);

    // 轮询兜底：每 2s 检查一次 webview 是否已加载内容
    // 解决 Electron webview 事件不触发的问题
    const pollInterval = setInterval(() => {
      const wv = registryRef.current.get(accId);
      if (!wv) { clearInterval(pollInterval); return; }
      
      const url = wv.getURL?.() || '';
      const isLoaded = loadingMapRef.current.get(accId);
      
      if (isLoaded && url.startsWith('http') && url.includes('doubao.com')) {
        console.log(`[BrowserPanel] 轮询检测到 webview 已加载: ${accId}, url=${url}`);
        markLoaded('poll');
        clearInterval(pollInterval);
      }
    }, 2000);

    // 60s 后停止轮询
    setTimeout(() => {
      clearInterval(pollInterval);
      if (loadingMapRef.current.get(accId)) {
        console.warn(`[BrowserPanel] 60s 超时，强制清除加载状态: ${accId}`);
        markLoaded('timeout');
      }
    }, 60000);
  };

  // ---- 切换可见性 ----
  useEffect(() => {
    if (!activeAccount) return;
    registryRef.current.forEach((webview, accountId) => {
      if (accountId === activeAccount.id) {
        webview.style.visibility = 'visible';
        webview.style.pointerEvents = 'auto';
        const isLoading = loadingMapRef.current.get(accountId);
        setActiveLoading(!!isLoading);
        if (!isLoading) setLoadText('');
      } else {
        webview.style.visibility = 'hidden';
        webview.style.pointerEvents = 'none';
      }
    });
  }, [activeAccount?.id]);

  const handleManual15sToggle = async (enabled: boolean) => {
    if (!activeAccount) return;
    const accountId = activeAccount.id;
    const webview = registryRef.current.get(accountId);
    if (!webview) {
      message.error('当前账号页面尚未就绪');
      return;
    }

    if (enabled) {
      await inject15sVideoPatch(webview);
    }
    const ok = await set15sVideoPatchEnabled(webview, enabled);
    if (!ok) {
      message.error('15 秒脚本开关设置失败，请刷新页面后重试');
      return;
    }

    manual15sRef.current[accountId] = enabled;
    setManual15sByAccount((current) => ({ ...current, [accountId]: enabled }));
    message.success(enabled ? '手动 15 秒脚本已开启' : '手动 15 秒脚本已关闭');
  };

  // ---- 立即终止自动化等待；可携带新提示词，在终止后重新排队 ----
  useEffect(() => {
    const handleCancelAutomation = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: string; restartTask?: TaskUpdateInput }>).detail;
      if (!detail?.taskId) return;
      if (detail.restartTask?.prompt?.trim()) {
        pendingRestartTasksRef.current.set(detail.taskId, {
          ...detail.restartTask,
          prompt: detail.restartTask.prompt.trim(),
        });
      }
      const controller = abortControllersRef.current.get(detail.taskId);
      if (controller) {
        controller.abort();
        message.info(detail.restartTask ? '正在停止旧任务并重新排队...' : '正在取消任务等待...');
      }
    };

    window.addEventListener('cancel-task-automation', handleCancelAutomation);
    return () => window.removeEventListener('cancel-task-automation', handleCancelAutomation);
  }, []);

  // ---- 手动补抓视频产物/去水印 ----
  useEffect(() => {
    const handleManualExtract = async (event: Event) => {
      const customEvent = event as CustomEvent<{ task: Task }>;
      const task = customEvent.detail?.task;
      if (!task || task.mode !== 'video') return;

      const accountId = task.assignedAccountId;
      const webview = accountId ? registryRef.current.get(accountId) : null;
      if (!accountId || !webview) {
        message.error('未找到该任务对应的账号页面');
        return;
      }
      if (useTaskStore.getState().accountBusy[accountId]) {
        message.warning('该账号正在执行其他任务，请暂停或等待完成后再提取');
        return;
      }

      try {
        useAccountStore.getState().selectAccount(accountId);
        useTaskStore.getState().setAccountAutomationState(accountId, 'generating', '手动提取视频地址...');
        const conversationUrl = task.runtime?.conversationUrl;
        if (conversationUrl && webview.getURL() !== conversationUrl) {
          message.info('正在打开该任务对应的豆包对话...');
          webview.loadURL(conversationUrl);
          await waitForWebviewReady(webview, 20_000);
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
        const outputs = await extractVideoOutputs(webview);
        if (outputs.length === 0) {
          message.warning('暂未提取到视频下载地址，请稍后再试');
          useTaskStore.getState().setAccountAutomationState(accountId, 'idle', '');
          return;
        }

        await useTaskStore.getState().updateTaskStatus(task.id, 'done', outputs[0], outputs);
        useTaskStore.getState().setAccountAutomationState(accountId, 'completed', '视频地址已提取');
        message.success(`已为该任务绑定 ${outputs.length} 个视频地址`);
      } catch (err: any) {
        message.error(`提取失败：${err.message || err}`);
        useTaskStore.getState().setAccountAutomationState(accountId, 'idle', '');
      }
    };

    window.addEventListener('manual-extract-video-output', handleManualExtract);
    return () => window.removeEventListener('manual-extract-video-output', handleManualExtract);
  }, []);

  // ---- V3 自动化：监听 per-account 执行状态 ----
  useEffect(() => {
    accounts.forEach((account) => {
      const accountId = account.id;
      const isBusy = accountBusy[accountId];
      const taskId = executingTasks[accountId];
      const webview = registryRef.current.get(accountId);
      if (!isBusy || !taskId || !webview) return;
      if (runningRef.current.has(accountId)) return;
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      console.log(`[BrowserPanel] 路由任务 ${taskId} → ${accountId}`);
      runningRef.current.add(accountId);
      executeAutomation(accountId, taskId, task.prompt, task.mode || "chat", webview, task.videoConfig, task.attachments, task.audioAttachment);
    });
  }, [accountBusy, executingTasks]);

  // ---- 自动化执行 ----
  const executeAutomation = async (
    accountId: string,
    taskId: string,
    prompt: string,
    mode: string,
    webview: HTMLWebViewElement,
    videoConfig?: Task['videoConfig'],
    attachments?: string[],
    audioAttachment?: string
  ) => {
    const { setAccountAutomationState, updateTaskRuntime, completeAutomation, pauseAutomation, failAutomation, updateTask } =
      useTaskStore.getState();
    const controller = new AbortController();
    abortControllersRef.current.set(taskId, controller);
    const pause = (ms: number) => sleepWithAbort(ms, controller.signal);
    try {
      console.log(`[Automation:${accountId}] 开始`);
      for (let submissionAttempt = 0; submissionAttempt < 3; submissionAttempt++) {
      setAccountAutomationState(accountId, 'injecting', '正在创建新对话...', 'new_conversation');
      const newConversationReady = await startNewConversation(webview);
      if (!newConversationReady) throw new Error('创建新对话失败');
      await waitForWebviewReady(webview, 15000);
      await updateTaskRuntime(taskId, { runtime: { conversationUrl: webview.getURL() } });
      // 根据任务模式切换到对应页面
      if (mode && mode !== 'chat') {
        const modeLabel = mode === 'image' ? '图片' : mode === 'video' ? '视频' : mode === 'music' ? '音乐' : mode;
        setAccountAutomationState(accountId, 'injecting', '切换到' + modeLabel + '模式...', 'switching_mode');
        switchMode(webview, mode);
        await waitForWebviewReady(webview, 20000);

        // image/video 模式：在 AI 创作页面点击 Tab 切换
        if (mode === 'image' || mode === 'video') {
          setAccountAutomationState(accountId, 'injecting', '点击' + modeLabel + 'Tab...', 'switching_mode');
          await clickAITab(webview, mode);
          await pause(1500); // 等待 Tab 切换动画
        }

        // 视频模式：配置参数 + 按需注入 15s 补丁
        if (mode === 'video') {
          // 所有视频任务均安装网络监听；是否改写为 15 秒由独立开关控制。
          const need15sPatch = videoConfig?.duration === '15s';
          await inject15sVideoPatch(webview);
          await set15sVideoPatchEnabled(webview, need15sPatch);
          if (need15sPatch) {
            setAccountAutomationState(accountId, 'injecting', '注入 15s 时长补丁...', 'configuring');
            await pause(500);
          }
          if (videoConfig) {
            setAccountAutomationState(accountId, 'injecting', '配置视频参数...', 'configuring');
            await configureVideoOptions(webview, videoConfig);
            await pause(500);
          }
        }

        // 有参考图片时上传
        if (attachments && attachments.length > 0) {
          setAccountAutomationState(accountId, 'injecting', '上传参考图片...', 'uploading_assets');
          // 读取文件为 base64
          const fileDataList: Array<{ name: string; base64: string; mime: string }> = [];
          for (const filePath of attachments) {
            try {
              const result = await window.electronAPI.tasks.readFileAsBase64(filePath);
              if (result.success && result.data) {
                const fileName = filePath.split(/[/\\]/).pop() || 'image.jpg';
                const mimeMatch = result.data.match(/^data:(image\/\w+);base64,/);
                const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                const base64 = result.data.replace(/^data:image\/\w+;base64,/, '');
                fileDataList.push({ name: fileName, base64, mime });
              }
            } catch (e: any) {
              console.warn(`[BrowserPanel] 读取文件失败 ${filePath}:`, e.message);
            }
          }
          if (fileDataList.length > 0) {
            await uploadReferenceImages(webview, fileDataList);
          }
          await pause(1000);
        }

        // 有参考音频时上传（仅视频模式）
        if (mode === 'video' && audioAttachment) {
          setAccountAutomationState(accountId, 'injecting', '上传参考音频...', 'uploading_assets');
          try {
            const result = await window.electronAPI.tasks.readFileAsBase64(audioAttachment);
            if (result.success && result.data) {
              const fileName = audioAttachment.split(/[/\\]/).pop() || 'audio.mp3';
              const mimeMatch = result.data.match(/^data:(audio\/[\w.+-]+);base64,/);
              const mime = mimeMatch ? mimeMatch[1] : 'audio/mpeg';
              const base64 = result.data.replace(/^data:audio\/[\w.+-]+;base64,/, '');
              await uploadReferenceAudio(webview, { name: fileName, base64, mime });
              await pause(800);
            }
          } catch (e: any) {
            console.warn(`[BrowserPanel] 上传音频失败:`, e.message);
          }
        }
      } else {
        await waitForWebviewReady(webview, 15000);
      }

      // 注入生成状态网络监听器（后台 webview 也能准确检测生成完成）
      await injectGenerationMonitor(webview);
      if (mode === 'video') {
        await resetVideoCaptureCache(webview);
      }

      setAccountAutomationState(accountId, 'injecting', '正在注入提示词...', 'injecting_prompt');
      const injected = await Promise.race([
        injectPrompt(webview, prompt),
        new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error('注入超时')), 60000)),
      ]);
      if (!injected) throw new Error('注入失败');
      await pause(800);

      setAccountAutomationState(accountId, 'submitting', '正在发送...', 'submitting');
      let submitted = false;
      // 视频/图片模式下直接用发送按钮提交（聊天+标签模式，发送按钮就是提交）
      // 之前的"生成视频"文字按钮会发送默认提示词，不是输入框内容
      submitted = await Promise.race([
        submitPrompt(webview),
        new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error('提交超时')), 10000)),
      ]);
      if (!submitted) throw new Error('提交失败');

      let verificationDetected = false;
      for (let check = 0; check < 12; check++) {
        if (await detectRobotVerification(webview)) {
          verificationDetected = true;
          break;
        }
        await pause(1000);
      }

      if (verificationDetected) {
        await useAccountStore.getState().recordAccountOutcome(accountId, 'verification', 'verification');
        useAccountStore.getState().selectAccount(accountId);
        setAccountAutomationState(accountId, 'submitting', '请手动完成机器人验证，完成后将自动重新提交...', 'waiting_verification');
        let clearChecks = 0;
        for (let waitCheck = 0; waitCheck < 900; waitCheck++) {
          await pause(1000);
          if (await detectRobotVerification(webview)) {
            clearChecks = 0;
          } else {
            clearChecks++;
            if (clearChecks >= 2) break;
          }
        }
        if (clearChecks < 2) throw new Error('等待机器人验证超时');
        if (submissionAttempt >= 2) throw new Error('机器人验证后连续重新提交失败');
        setAccountAutomationState(accountId, 'injecting', '验证已完成，正在新对话中重新上传并提交...', 'new_conversation');
        await pause(1000);
        continue;
      }

      break;
      }

      setAccountAutomationState(accountId, 'generating', '等待豆包生成回复...', 'generating');
      await pause(3000);
      await updateTaskRuntime(taskId, {
        runtime: { conversationUrl: webview.getURL(), lastHeartbeatAt: new Date().toISOString() },
      });

      // 记录初始消息数（用于兜底判断）
      let initialMsgCount = 0;
      try {
        const initial = await checkGeneratingDetailed(webview);
        initialMsgCount = initial.messageCount || 0;
      } catch {}

      let generating = true;
      let unknownCount = 0;
      const maxUnknown = 10; // 连续 10 次无法确定（约 30 秒）触发兜底

      for (let i = 0; i < 200; i++) {
        await pause(3000);
        try {
          const detail = await Promise.race([
            checkGeneratingDetailed(webview),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('检测超时')), 8000)),
          ]);

          if (detail.status === 'detected') {
            // 明确检测到结果
            generating = detail.generating;
            unknownCount = 0;
          } else {
            // 无法确定，使用消息数量兜底
            unknownCount++;
            const currentMsgCount = detail.messageCount || 0;
            // 如果消息数增加了（说明有新回复），且最新消息有产物或输入框可用，认为完成
            if (unknownCount >= maxUnknown && currentMsgCount > initialMsgCount) {
              console.log(`[Automation:${accountId}] 兜底检测：消息数从 ${initialMsgCount} → ${currentMsgCount}，认为生成完成`);
              generating = false;
            }
          }
        } catch {
          unknownCount++;
          // JS 注入失败也计入 unknown
          if (unknownCount >= maxUnknown * 2) {
            console.warn(`[Automation:${accountId}] 连续 ${unknownCount} 次检测失败，继续等待`);
            unknownCount = maxUnknown; // 防止溢出
          }
        }
        if (mode === 'video') {
          const blocker = await detectVideoGenerationBlocker(webview);
          if (blocker) throw new Error(`豆包已停止生成：${blocker}`);
        }
        if (!generating) break;
        setAccountAutomationState(accountId, 'generating', `等待回复... (${(i + 1) * 3}s)`, 'generating');
      }
      if (generating) throw new Error('生成超时');

      setAccountAutomationState(accountId, 'generating', '正在识别并绑定任务产物...', 'extracting_outputs');

      // 生成完成后获取产物
      let imageUrls: string[] = [];

      if (mode === 'video') {
        // 视频生成耗时经常远超普通回复结束时间；以拿到视频地址为准。
        const maxVideoWaitMs = 60 * 60 * 1000;
        const pollIntervalMs = 10000;
        const startWait = Date.now();
        let pollCount = 0;
        let lastLogBucket = -1;

        while (Date.now() - startWait < maxVideoWaitMs) {
          pollCount++;

          imageUrls = await extractVideoOutputs(webview);
          if (imageUrls.length > 0) {
            console.log(`[Automation:${accountId}] 获取视频地址成功: ${imageUrls.length} 个`);
            break;
          }

          const blocker = await detectVideoGenerationBlocker(webview);
          if (blocker) {
            throw new Error(`豆包已停止生成：${blocker}`);
          }

          const elapsedSec = Math.round((Date.now() - startWait) / 1000);
          const maxSec = Math.round(maxVideoWaitMs / 1000);
          const logBucket = Math.floor(elapsedSec / 60);
          if (logBucket !== lastLogBucket || pollCount <= 3) {
            console.log(`[Automation:${accountId}] 视频产物尚未就绪，继续等待 (${elapsedSec}/${maxSec}s, 第 ${pollCount} 次)`);
            lastLogBucket = logBucket;
          }
          setAccountAutomationState(accountId, 'generating', `等待视频产物... (${Math.floor(elapsedSec / 60)}/${Math.floor(maxSec / 60)}分钟)`, 'extracting_outputs');
          await pause(pollIntervalMs);
        }

        if (imageUrls.length === 0) {
          throw new Error('视频产物等待超时，尚未获取到可下载地址');
        }
      } else {
        // 图片模式：用 DOM 提取，最多重试 5 次
        for (let retry = 0; retry < 5; retry++) {
          const rawResult = await getResultUrl(webview);
          try {
            imageUrls = JSON.parse(rawResult);
          } catch {
            imageUrls = rawResult ? [rawResult] : [];
          }
          if (imageUrls.length > 0) break;
          console.log(`[Automation:${accountId}] 产物尚未加载，等待 2s 后重试 (${retry + 1}/5)`);
          await pause(2000);
        }
      }
      console.log(`[Automation:${accountId}] 完成, 产物:`, imageUrls);
      if (controller.signal.aborted) {
        throw new DOMException('任务已取消', 'AbortError');
      }
      if (mode === 'video') {
        const usageUnits = videoConfig?.model === 'seedance-2.0' ? 2 : 1;
        await useAccountStore.getState().recordSeedanceUsage(accountId, usageUnits);
      }
      await useAccountStore.getState().recordAccountOutcome(accountId, 'success');
      // 传入第一个 URL 作为 result（向后兼容），outputs 传完整数组
      await completeAutomation(taskId, accountId, imageUrls[0] || '', imageUrls);
    } catch (err: any) {
      const cancelled = err?.name === 'AbortError';
      const errorMessage = cancelled ? '用户已取消等待' : (err.message || String(err));
      const errorInfo = classifyTaskError(errorMessage);
      if (mode === 'video' && errorInfo.code === 'quota_exhausted') {
        await useAccountStore.getState().markSeedanceExhausted(accountId);
      }
      if (!cancelled) {
        await useAccountStore.getState().recordAccountOutcome(accountId, 'failure', errorInfo.code);
      }
      console.error(`[Automation:${accountId}] ${cancelled ? '已取消' : '失败'}:`, errorMessage);
      if (cancelled) {
        await pauseAutomation(taskId, accountId, '用户已暂停，可随时重新执行');
      } else {
        setAccountAutomationState(accountId, 'failed', errorMessage, 'failed');
        await failAutomation(taskId, accountId, errorMessage, errorInfo);
      }

      const restartTask = pendingRestartTasksRef.current.get(taskId);
      if (restartTask) {
        pendingRestartTasksRef.current.delete(taskId);
        const updated = await updateTask(taskId, restartTask);
        if (updated) message.success('提示词已更新，任务已重新加入队列');
      }
    } finally {
      abortControllersRef.current.delete(taskId);
      pendingRestartTasksRef.current.delete(taskId);
      if (mode === 'video') {
        await set15sVideoPatchEnabled(webview, !!manual15sRef.current[accountId]);
      }
      runningRef.current.delete(accountId);
      setTimeout(() => useTaskStore.getState().processQueue(), 0);
    }
  };

  // ---- 导航 ----
  const getActiveWebview = useCallback(() => {
    if (!activeAccount) return null;
    return registryRef.current.get(activeAccount.id) || null;
  }, [activeAccount]);

  const handleRefresh = useCallback(() => { getActiveWebview()?.reload(); }, [getActiveWebview]);
  const handleGoBack = useCallback(() => { const w = getActiveWebview(); if (w?.canGoBack()) w.goBack(); }, [getActiveWebview]);
  const handleGoForward = useCallback(() => { const w = getActiveWebview(); if (w?.canGoForward()) w.goForward(); }, [getActiveWebview]);
  const handleGoHome = useCallback(() => { getActiveWebview()?.loadURL('https://www.doubao.com/chat/'); }, [getActiveWebview]);

  if (!activeAccount) {
    return (
      <div className="browser-panel-empty">
        <div className="browser-empty-content">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="4" y="8" width="56" height="40" rx="4" stroke="#38385a" strokeWidth="2" />
            <path d="M4 16h56" stroke="#38385a" strokeWidth="2" />
            <circle cx="12" cy="12" r="2" fill="#38385a" />
            <circle cx="19" cy="12" r="2" fill="#38385a" />
            <circle cx="26" cy="12" r="2" fill="#38385a" />
          </svg>
          <p>选择一个账号以打开浏览器</p>
        </div>
      </div>
    );
  }

  const showOverlay = activeAutoState && activeAutoState !== 'idle' && activeAutoState !== 'completed' && activeAutoState !== 'failed';

  return (
    <div className="browser-panel">
      <div className="browser-toolbar">
        <div className="browser-nav-buttons">
          <button onClick={handleGoBack} title="后退">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.5 3L5.5 8l5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={handleGoForward} title="前进">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 3l5 5-5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={handleRefresh} title="刷新">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.5 8a5.5 5.5 0 00-10-2.5M2.5 8a5.5 5.5 0 0010 2.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <path d="M2 3v3h3M14 13v-3h-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={handleGoHome} title="回到豆包首页">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 6l6-4.5L14 6v7.5a.5.5 0 01-.5.5h-3.5V9H6v5H2.5a.5.5 0 01-.5-.5V6z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="browser-url-bar">
          <span className="browser-url-text">doubao.com</span>
        </div>
        <Tooltip title="开启后，当前账号在页面中手动提交的视频请求会被改为 15 秒">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <Switch
              size="small"
              checked={!!manual15sByAccount[activeAccount.id]}
              disabled={!!accountBusy[activeAccount.id]}
              onChange={handleManual15sToggle}
            />
            <span style={{ color: '#9898b8', fontSize: 12, whiteSpace: 'nowrap' }}>手动 15s</span>
          </div>
        </Tooltip>
      </div>

      <div className="browser-viewport">
        {activeLoading && (
          <div className="browser-loading-overlay">
            <div className="browser-loading-spinner" />
            <span>{loadText}</span>
          </div>
        )}

        {showOverlay && (
          <div className="automation-overlay">
            <div className="automation-indicator">
              <div className="automation-spinner" />
              <span>{activeAutoMsg}</span>
            </div>
          </div>
        )}

        {activeAutoState === 'completed' && (
          <div className="automation-toast completed">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" stroke="#34d399" strokeWidth="2" />
              <path d="M5.5 9l2.5 2.5 4.5-5" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{activeAutoMsg}</span>
          </div>
        )}

        {activeAutoState === 'failed' && (
          <div className="automation-toast failed">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" stroke="#fb7185" strokeWidth="2" />
              <path d="M6 6l6 6M12 6l-6 6" stroke="#fb7185" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>执行失败: {activeAutoMsg}</span>
          </div>
        )}

        <div
          ref={poolRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
};

function waitForWebviewReady(webview: HTMLWebViewElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const poll = async () => {
      if (Date.now() - startTime >= timeoutMs) {
        reject(new Error('页面就绪检测超时（' + timeoutMs + 'ms）'));
        return;
      }
      try {
        const ready = await waitForChatReady(webview, 3000);
        if (ready) resolve();
        else setTimeout(poll, 1000);
      } catch {
        setTimeout(poll, 1000);
      }
    };
    poll();
  });
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('任务已取消', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('任务已取消', 'AbortError'));
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

export default BrowserPanel;
