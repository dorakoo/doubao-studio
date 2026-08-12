/**
 * IPC handler 生命周期协调器。
 *
 * Electron 的 ipcMain.handle 不允许同一 channel 重复注册。开发热重载或测试
 * 重复初始化时，先替换旧 handler；旧注册批次的 disposer 只能清理自己仍持有
 * 的 channel，不能误删后来注册的新 handler。
 */

export interface IpcHandlerRegistry {
  removeHandler(channel: string): void;
}

const activeOwners = new WeakMap<object, Map<string, symbol>>();

export function replaceIpcHandlers(
  registry: IpcHandlerRegistry,
  channels: readonly string[],
): () => void {
  const uniqueChannels = [...new Set(channels)];
  if (uniqueChannels.length !== channels.length || uniqueChannels.some((channel) => !channel.trim())) {
    throw new Error('IPC channel 清单必须为非空且不可重复');
  }

  const registryKey = registry as object;
  const owners = activeOwners.get(registryKey) ?? new Map<string, symbol>();
  activeOwners.set(registryKey, owners);
  const owner = Symbol('ipc-registration');

  for (const channel of uniqueChannels) {
    registry.removeHandler(channel);
    owners.set(channel, owner);
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const channel of uniqueChannels) {
      if (owners.get(channel) !== owner) continue;
      registry.removeHandler(channel);
      owners.delete(channel);
    }
    if (owners.size === 0) activeOwners.delete(registryKey);
  };
}
