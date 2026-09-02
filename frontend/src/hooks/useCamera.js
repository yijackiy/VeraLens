import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One still photo from the webcam — never video, never a recording.
 *
 * start() is deliberately called from a click handler rather than an effect:
 * the permission prompt belongs to a user gesture, and StrictMode fires
 * effects twice in development, which would ask for the camera twice.
 *
 * Every exit path has to reach stop(). The camera light stays on until every
 * track is stopped, and a light left burning after a demo is the kind of thing
 * people remember about a piece of software.
 */
export function useCamera() {
  const [stream, setStream] = useState(null)
  const streamRef = useRef(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const start = useCallback(async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: 'insecure' }
    }
    try {
      const opened = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = opened
      setStream(opened)
      return { ok: true }
    } catch (error) {
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        return { ok: false, reason: 'refused' }
      }
      if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
        return { ok: false, reason: 'no-camera' }
      }
      return { ok: false, reason: 'failed' }
    }
  }, [])

  /** Freeze the current frame into a JPEG File, then release the camera. */
  const capture = useCallback((video) => {
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          const stamp = new Date()
          resolve(
            blob
              ? new File([blob], `camera-${stamp.toISOString().slice(11, 19).replace(/:/g, '')}.jpg`, {
                  type: 'image/jpeg',
                  lastModified: stamp.getTime(),
                })
              : null,
          )
        },
        'image/jpeg',
        0.95,
      )
    })
  }, [])

  useEffect(() => stop, [stop])

  return { stream, start, stop, capture }
}
