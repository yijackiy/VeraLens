import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Page } from '../components/Layout'
import { Sidebar, FILE_GUIDANCE } from '../components/Sidebar'
import { useBackendStatus } from '../hooks/useBackendStatus'
import { rejectionReason } from '../lib/analysis'

/**
 * Screen 11 — both photos up front.
 *
 * The other way into a Comparison starts from a finished verdict, which suits
 * "I've just seen this and now I'm curious". This one suits knowing in advance
 * that you want two compared, and it exists because doing that through the
 * single-photo flow meant analysing, waiting, pressing compare, and uploading
 * again.
 *
 * What it does not do is make anything faster. There is one graphics card and
 * the backend takes one analysis at a time, so the two run strictly in
 * sequence — the screen says so rather than implying a batch.
 */
export function ComparePickScreen({ onAnalyseBoth, onSinglePhoto, onHowItWorks }) {
  const [slots, setSlots] = useState({ a: null, b: null })
  const [rejection, setRejection] = useState(null)
  const backend = useBackendStatus()

  // The previews are object URLs and this screen owns them: they are revoked
  // when a slot is replaced, when the screen closes, and never after being
  // handed on — App adopts the File, not the URL, and makes its own.
  const slotsRef = useRef(slots)
  useEffect(() => {
    slotsRef.current = slots
  }, [slots])
  useEffect(
    () => () => {
      Object.values(slotsRef.current).forEach((slot) => slot && URL.revokeObjectURL(slot.url))
    },
    [],
  )

  const put = useCallback((key, file) => {
    if (!file) return
    const reason = rejectionReason(file)
    if (reason) {
      setRejection(reason)
      return
    }
    setRejection(null)
    setSlots((previous) => {
      if (previous[key]) URL.revokeObjectURL(previous[key].url)
      return { ...previous, [key]: { file, url: URL.createObjectURL(file) } }
    })
  }, [])

  const clear = useCallback((key) => {
    setSlots((previous) => {
      if (previous[key]) URL.revokeObjectURL(previous[key].url)
      return { ...previous, [key]: null }
    })
  }, [])

  const ready = Boolean(slots.a && slots.b)

  return (
    <Page onHome={onSinglePhoto} onHelp={onHowItWorks}>
      <div className="flex flex-col gap-8 lg:flex-row">
        <Sidebar guidance={FILE_GUIDANCE} onHowItWorks={onHowItWorks} />

        <section className="flex flex-grow flex-col gap-6">
          <button
            type="button"
            onClick={onSinglePhoto}
            className="flex w-fit cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-ink-muted hover:text-terracotta-ink"
          >
            <Icon name="arrow_back" size={20} />
            <span className="label-caps">One photo instead</span>
          </button>

          <div className="flex flex-col gap-2">
            <h1 className="m-0 font-serif text-verdict-md font-semibold text-ink-strong">
              Two photos, one scale
            </h1>
            <p className="m-0 max-w-2xl text-body-md text-ink-muted">
              Both go through the same pipeline at the same threshold and end up on the same axis.
              Choosing them together only saves you the trip back — it does not make the answers
              more comparable than they already were.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Slot label="A" slot={slots.a} onPick={(file) => put('a', file)} onClear={() => clear('a')} />
            <Slot label="B" slot={slots.b} onPick={(file) => put('b', file)} onClear={() => clear('b')} />
          </div>

          {rejection && (
            <div className="flex items-start gap-3.5 rounded-xl bg-terracotta-tint px-5 py-4">
              <Icon name="error_outline" className="mt-0.5 text-terracotta-ink" size={22} />
              <p className="m-0 text-body-sm text-terracotta-deep">{rejection}</p>
            </div>
          )}

          {backend.status === 'down' && (
            <div className="flex items-start gap-3.5 rounded-xl bg-terracotta-tint px-5 py-4">
              <Icon name="cloud_off" className="mt-0.5 text-terracotta-ink" size={22} />
              <p className="m-0 text-body-sm text-terracotta-deep">
                The analysis server isn't answering, so nothing can be analysed yet.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-4 rounded-xl border border-line bg-cream p-6">
            <div className="flex items-start gap-3.5">
              <Icon name="schedule" className="mt-0.5 text-terracotta-ink" size={22} />
              <p className="m-0 text-body-sm text-ink-muted">
                They run one after another, not at the same time — there is one graphics card and
                the backend takes one analysis at a time. Photo A's full result appears as soon as
                it lands, while photo B is still running.
              </p>
            </div>

            <Button onClick={() => onAnalyseBoth(slots.a.file, slots.b.file)} disabled={!ready}>
              <Icon name="compare" size={20} />
              {ready ? 'Analyse both photos' : 'Choose both photos first'}
            </Button>
          </div>
        </section>
      </div>
    </Page>
  )
}

function Slot({ label, slot, onPick, onClear }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  if (slot) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4 shadow-ambient">
        <div className="flex items-center justify-between gap-3">
          <span className="label-caps flex h-6.5 w-6.5 items-center justify-center rounded-full bg-sage-tint text-sage-ink">
            {label}
          </span>
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove photo ${label}`}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-ink-muted hover:bg-container-high hover:text-terracotta-ink"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="h-48 w-full overflow-hidden rounded-xl bg-slate">
          <img
            src={slot.url}
            alt={`The photograph chosen as ${label}`}
            className="h-full w-full object-contain"
          />
        </div>

        <span className="truncate font-mono text-data-mono text-ink" title={slot.file.name}>
          {slot.file.name}
        </span>
      </div>
    )
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        onPick(event.dataTransfer.files?.[0])
      }}
      className={`flex min-h-[296px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
        dragging ? 'border-sage bg-cream' : 'border-outline-variant bg-paper'
      }`}
    >
      <span className="label-caps flex h-9 w-9 items-center justify-center rounded-full bg-container-high text-ink-muted">
        {label}
      </span>
      <h2 className="m-0 text-headline-sm font-semibold text-ink-strong">Photo {label}</h2>
      <p className="m-0 max-w-[240px] text-body-sm text-ink-muted">
        Drag it here, or click to choose from your files.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          onPick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
