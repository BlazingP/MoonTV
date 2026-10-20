import { RemoteCommand, RemoteDevice } from '@/lib/remote/types';

/** 命令发出后先在本地推演状态，之后以电视上报的真实状态为准。 */
export function applyOptimistic(
  device: RemoteDevice,
  command: RemoteCommand
): RemoteDevice {
  const status = device.status;
  if (!status) return device;
  switch (command.type) {
    case 'toggle':
      return { ...device, status: { ...status, paused: !status.paused } };
    case 'play':
      return { ...device, status: { ...status, paused: false } };
    case 'pause':
      return { ...device, status: { ...status, paused: true } };
    case 'seek':
      return { ...device, status: { ...status, currentTime: command.time } };
    case 'fullscreen':
      return { ...device, status: { ...status, fullscreen: command.on } };
    case 'episode':
      return {
        ...device,
        status: { ...status, episodeIndex: command.index, currentTime: 0 },
      };
    case 'source':
      return {
        ...device,
        status: { ...status, source: command.source, id: command.id },
      };
    default:
      return device;
  }
}
