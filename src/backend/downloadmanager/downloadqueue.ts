import { TypeCheckedStoreBackend } from './../electron_store'
import { logError, logInfo, LogPrefix } from '../logger/logger'
import { getFileSize, getGame, getMainWindow } from '../utils'
import { DMQueueElement } from 'common/types'
import { installQueueElement, updateQueueElement } from './utils'

const downloadManager = new TypeCheckedStoreBackend('downloadManager', {
  cwd: 'store',
  name: 'download-manager'
})

/* 
#### Private ####
*/

type DownloadManagerState = 'idle' | 'running'
type DMStatus = 'done' | 'error' | 'abort'
let queueState: DownloadManagerState = 'idle'

function getFirstQueueElement() {
  const elements = downloadManager.get('queue', [])
  return elements.at(0) ?? null
}

function addToFinished(element: DMQueueElement, status: DMStatus) {
  const elements = downloadManager.get('finished', [])

  const elementIndex = elements.findIndex(
    (el) => el.params.appName === element.params.appName
  )

  if (elementIndex >= 0) {
    elements[elementIndex] = { ...element, status: status ?? 'abort' }
  } else {
    elements.push({ ...element, status })
  }

  downloadManager.set('finished', elements)
  logInfo([element.params.appName, 'added to download manager finished.'], {
    prefix: LogPrefix.DownloadManager
  })
}

/* 
#### Public ####
*/

async function initQueue() {
  const window = getMainWindow()
  let element = getFirstQueueElement()
  queueState = element ? 'running' : 'idle'

  while (element) {
    const queuedElements = downloadManager.get('queue', [])
    window.webContents.send('changedDMQueueInformation', queuedElements)
    const game = getGame(element.params.appName, element.params.runner)
    const installInfo = await game.getInstallInfo(
      element.params.platformToInstall
    )
    element.params.size = installInfo?.manifest?.download_size
      ? getFileSize(installInfo?.manifest?.download_size)
      : '?? MB'
    element.startTime = Date.now()
    queuedElements[0] = element
    downloadManager.set('queue', queuedElements)

    const { status } =
      element.type === 'install'
        ? await installQueueElement(window, element.params)
        : await updateQueueElement(window, element.params)
    element.endTime = Date.now()
    addToFinished(element, status)
    removeFromQueue(element.params.appName)
    element = getFirstQueueElement()
  }
  queueState = 'idle'
}

function addToQueue(element: DMQueueElement) {
  if (!element) {
    logError('Can not add undefined element to queue!', {
      prefix: LogPrefix.DownloadManager
    })
    return
  }

  const mainWindow = getMainWindow()
  mainWindow.webContents.send('setGameStatus', {
    appName: element.params.appName,
    runner: element.params.runner,
    folder: element.params.path,
    status: 'queued'
  })

  const elements = downloadManager.get('queue', [])

  const elementIndex = elements.findIndex(
    (el) => el.params.appName === element.params.appName
  )

  if (elementIndex >= 0) {
    elements[elementIndex] = element
  } else {
    elements.push(element)
  }

  downloadManager.set('queue', elements)
  logInfo([element.params.appName, 'added to download manager queue.'], {
    prefix: LogPrefix.DownloadManager
  })

  getMainWindow().webContents.send('changedDMQueueInformation', elements)

  if (queueState === 'idle') {
    initQueue()
  }
}

function removeFromQueue(appName: string) {
  const mainWindow = getMainWindow()

  if (appName && downloadManager.has('queue')) {
    const elements = downloadManager.get('queue', [])
    const index = elements.findIndex(
      (queueElement) => queueElement?.params.appName === appName
    )
    if (index !== -1) {
      elements.splice(index, 1)
      downloadManager.delete('queue')
      downloadManager.set('queue', elements)
    }

    mainWindow.webContents.send('setGameStatus', {
      appName,
      status: 'done'
    })

    logInfo([appName, 'removed from download manager.'], {
      prefix: LogPrefix.DownloadManager
    })

    getMainWindow().webContents.send('changedDMQueueInformation', elements)
  }
}

function clearFinished() {
  if (downloadManager.has('finished')) {
    downloadManager.delete('finished')
  }
}

function getQueueInformation() {
  const elements = downloadManager.get('queue', [])
  const finished = downloadManager.get('finished', [])

  return { elements, finished }
}

export {
  initQueue,
  addToQueue,
  removeFromQueue,
  clearFinished,
  getQueueInformation
}
