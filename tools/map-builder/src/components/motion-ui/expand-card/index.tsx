// @ts-nocheck — vendored pelo shadcn CLI; não edite (regra 6 da skill motion-plus-ui).
import {
  AnimatePresence,
  motion,
} from "motion/react"
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import { useMotionUITheme, useMotionUITransition } from "@/components/motion-ui/ui-theme"
import type { UITransition } from "@/components/motion-ui/ui-theme"
import { Backdrop, useFocusTrap, useScrollLock } from "../overlay"

/**
 * ==============   Context   ================
 */

interface ExpandCardsContextValue {
  /** The id of the currently expanded card, or `null` when none is open. */
  openId: string | null
  /** Expand the card with this id. */
  open: (id: string) => void
  /** Collapse the open card. */
  close: () => void
  /** Scrim opacity behind an open card (0-1). */
  scrimOpacity: number
  /** Stable prefix keeping this group's shared `layoutId`s from colliding
   *  with any other `ExpandCards` mounted on the same page. */
  group: string
  /** Reduced-motion strategy "off": mount no animation at all. */
  still: boolean
  /** Reduced-motion strategy "calm": keep opacity fades, drop travel/morph. */
  calm: boolean
  /** Full motion: run the shared-element layout morph. False under either
   *  reduced-motion strategy. */
  animateLayout: boolean
  /** The theme's default ("ui") transition every morphing part shares. */
  ui: UITransition
  /** The large-surface ("gentle") transition the scrim fades over. */
  gentle: UITransition
  /** The instant ("snap") transition the body cross-fade rides after the
   *  morph. */
  snap: UITransition
}

const ExpandCardsContext = createContext<ExpandCardsContextValue | null>(null)

function useExpandCardsContext(): ExpandCardsContextValue {
  const ctx = useContext(ExpandCardsContext)
  if (!ctx) {
    throw new Error(
      "ExpandCardTrigger, ExpandCardPanel, ExpandCardShared, ExpandCardBody and useExpandCard must be used inside <ExpandCards>."
    )
  }
  return ctx
}

/** The id of the card a shared sub-element belongs to - the trigger supplies
 *  its own id, the open panel supplies `openId`, so one `ExpandCardShared`
 *  resolves the right `layoutId` in either place. */
const CardIdContext = createContext<string | null>(null)

/** Builds a shared-element `layoutId` from the group prefix, the part name
 *  and the card id, so a trigger's part and the panel's part match. */
function sharedId(group: string, part: string, id: string): string {
  return `${group}-${part}-${id}`
}

/**
 * ==============   useExpandCard   ================
 */

/** The open/close controls exposed to a consumer's own UI (a close button, a
 *  keyboard shortcut). */
export interface UseExpandCard {
  /** The id of the currently expanded card, or `null`. */
  openId: string | null
  /** Expand the card with this id. */
  open: (id: string) => void
  /** Collapse the open card. */
  close: () => void
  /** Whether the card with this id is the one currently expanded. */
  isOpen: (id: string) => boolean
}

/** Read the expand/collapse controls from inside an `ExpandCards` group - use
 *  it to wire a dialog close button (`onClick={close}`) or drive the group
 *  from your own affordance. */
export function useExpandCard(): UseExpandCard {
  const { openId, open, close } = useExpandCardsContext()
  return {
    openId,
    open,
    close,
    isOpen: (id: string) => openId === id,
  }
}

/**
 * ==============   ExpandCards   ================
 */

export interface ExpandCardsProps {
  /** Your grid of `ExpandCardTrigger`s and the single `ExpandCardPanel`. */
  children?: ReactNode
  /** Scrim opacity behind an open card (0-1). A visual constant, not global
   *  feel, so it stays a prop rather than a theme token. Defaults to 0.72. */
  scrimOpacity?: number
}

/**
 * The provider/group for a set of expanding cards. It owns which card is open
 * (`openId`), the reduced-motion decision every part reads, and the stable
 * `layoutId` prefix that lets several groups coexist on one page. Renders no
 * DOM of its own - drop it around your grid and its single `ExpandCardPanel`.
 */
export function ExpandCards({ children, scrimOpacity = 0.72 }: ExpandCardsProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const group = useId()

  const uiTheme = useMotionUITheme()
  // Theme reduced-motion strategy: "off" mounts no animation at all; "calm"
  // keeps opacity fades but drops travel and the layout morph. defaultTheme
  // ships "calm". The shared-element morph is transform travel, so it only
  // ever runs at full motion.
  const still = uiTheme.motionMode === "off"
  const calm = uiTheme.motionMode === "calm"
  const animateLayout = uiTheme.motionMode === "full"

  const ui = useMotionUITransition("ui")
  const gentle = useMotionUITransition("gentle")
  const snap = useMotionUITransition("snap")

  const open = useCallback((id: string) => setOpenId(id), [])
  const close = useCallback(() => setOpenId(null), [])

  const value = useMemo<ExpandCardsContextValue>(
    () => ({
      openId,
      open,
      close,
      scrimOpacity,
      group,
      still,
      calm,
      animateLayout,
      ui,
      gentle,
      snap,
    }),
    [openId, open, close, scrimOpacity, group, still, calm, animateLayout, ui, gentle, snap]
  )

  return (
    <ExpandCardsContext.Provider value={value}>
      {children}
    </ExpandCardsContext.Provider>
  )
}

/**
 * ==============   ExpandCardTrigger   ================
 */

export interface ExpandCardTriggerProps {
  /** The card's id - matched against `openId` and used to build the shared
   *  `layoutId`s so this tile morphs into the panel opened for the same id. */
  id: string
  /** Your card's visible content (an `ExpandCardShared` icon, a heading,
   *  a summary). Rendered inside the morphing surface. */
  children?: ReactNode
  /** Merged onto the morphing surface - style the card face here
   *  (`bg-card`, border, padding, `group-hover:*` feedback, ...). */
  className?: string
  /** The button's accessible name (the tile's text is often abbreviated, so
   *  give the whole "Title. Summary. Open for detail." here). */
  "aria-label"?: string
}

/**
 * A grid tile that expands on activation. Renders a real `<button>` (correct
 * keyboard + screen-reader semantics, `aria-haspopup="dialog"` and a live
 * `aria-expanded`) wrapping the morphing surface that carries the shared
 * `layoutId`. Hover/focus feedback is discrete colour only - style it via
 * `group-hover:*`/`group-focus-visible:*` in `className`, the `group` class is
 * already on the button.
 */
export function ExpandCardTrigger({
  id,
  children,
  className,
  "aria-label": ariaLabel,
}: ExpandCardTriggerProps) {
  const { openId, open, group, animateLayout, ui } = useExpandCardsContext()
  const isOpen = openId === id
  return (
    <CardIdContext.Provider value={id}>
      <button
        type="button"
        className="group block h-full w-full text-left focus-visible:outline-none"
        onClick={() => open(id)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <motion.div
          layoutId={animateLayout ? sharedId(group, "surface", id) : undefined}
          className={className}
          transition={{ ...ui }}
        >
          {children}
        </motion.div>
      </button>
    </CardIdContext.Provider>
  )
}

/**
 * ==============   ExpandCardShared   ================
 */

export interface ExpandCardSharedProps {
  /** A stable name for this morphing part (e.g. `"icon"`, `"head"`). Render
   *  one with the same `part` inside both the trigger and the panel and
   *  Motion flies it between them. */
  part: string
  /** Which element to render. Defaults to `"span"`. */
  as?: "span" | "div"
  /** Pass `"position"` to animate only the element's position during the
   *  morph (never its size), which stops a text block from being
   *  scale-stretched while the surface resizes. Ignored under reduced motion. */
  layout?: "position" | "size" | boolean
  /** Merged onto the element - size and style the part here. The trigger and
   *  panel can style the same part differently; the morph handles the delta. */
  className?: string
  /** The part's content. */
  children?: ReactNode
}

/**
 * Marks a sub-element that morphs in tandem with its card's surface. It reads
 * the card id from context (the trigger's own id, or the open panel's id), so
 * you render the same `part` in both places and it flies between them. Under
 * reduced motion it drops the `layoutId` and simply renders in place.
 */
export function ExpandCardShared({
  part,
  as = "span",
  layout,
  className,
  children,
}: ExpandCardSharedProps) {
  const { group, animateLayout, ui } = useExpandCardsContext()
  const cardId = useContext(CardIdContext)
  const MotionEl = as === "div" ? motion.div : motion.span
  return (
    <MotionEl
      layoutId={
        animateLayout && cardId != null ? sharedId(group, part, cardId) : undefined
      }
      layout={animateLayout ? layout : undefined}
      className={className}
      transition={{ ...ui }}
    >
      {children}
    </MotionEl>
  )
}

/**
 * ==============   ExpandCardPanel   ================
 */

export interface ExpandCardPanelProps {
  /** The dialog body. A render function receiving the open card's `id`
   *  (so you can look up its content and build matching element ids) is the
   *  usual form; a plain node works when the body does not vary by card. */
  children: ((card: { id: string }) => ReactNode) | ReactNode
  /** Merged onto the dialog surface - the morphing box (`bg-card`, border,
   *  `max-w-*`, `max-h-*`, `overflow-hidden`, ...). */
  className?: string
  /** Merged onto the inner `layout="position"` wrapper that holds your
   *  content (padding, gap, `overflow-y-auto`, ...). Kept separate from the
   *  surface so the position-only layout trick can sit between them. */
  contentClassName?: string
  /** Builds the dialog's `aria-labelledby` from the open card's id - point it
   *  at the id you set on your title element. */
  labelledBy?: (id: string) => string
  /** Builds the dialog's `aria-describedby` from the open card's id. */
  describedBy?: (id: string) => string
  /** Where focus lands when the dialog opens. Defaults to the first focusable
   *  descendant (typically your close button); pass your close button's ref
   *  to be explicit. */
  initialFocusRef?: RefObject<HTMLElement | null>
}

/**
 * The expanded detail dialog. There is exactly one per `ExpandCards` group; it
 * renders nothing until a card opens, then mounts inside an `AnimatePresence`
 * so it morphs in from the trigger and back out on close. It composes the
 * shared `overlay` primitives - `useFocusTrap` (Tab cycle, Escape, focus
 * restore to the trigger), `useScrollLock` (background scroll freeze) and
 * `Backdrop` (the click-out scrim) - so the accessibility plumbing lives in
 * one place, and wraps your content in a `layout="position"` element so the
 * morph never distorts it.
 */
export function ExpandCardPanel({
  children,
  className,
  contentClassName,
  labelledBy,
  describedBy,
  initialFocusRef,
}: ExpandCardPanelProps) {
  const { openId, close, scrimOpacity, group, still, calm, animateLayout, ui, gentle } =
    useExpandCardsContext()
  const panelRef = useRef<HTMLDivElement>(null)
  const isOpen = openId != null

  // Composed overlay a11y: freeze background scroll, trap focus in the panel,
  // route Escape to close, and restore focus to the trigger on close.
  useScrollLock(isOpen)
  useFocusTrap({
    active: isOpen,
    container: panelRef,
    onEscape: close,
    initialFocus: initialFocusRef,
    restoreFocus: true,
  })

  return (
    <AnimatePresence>
      {openId != null && (
        <CardIdContext.Provider key="expand-card-panel" value={openId}>
          <div className="fixed inset-0 z-1000 flex items-center justify-center p-4 sm:p-6">
            {/* The scrim: a large-surface fade (gentle, tween so opacity never
                springs). Backdrop's default surface is the documented bg-black
                scrim literal - it dims whatever is behind it in both light and
                dark mode. */}
            <Backdrop
              onClick={close}
              initial={{ opacity: 0 }}
              animate={{ opacity: scrimOpacity }}
              exit={{ opacity: 0 }}
              transition={still ? { duration: 0 } : { ...gentle, type: "tween" }}
            />

            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={labelledBy?.(openId)}
              aria-describedby={describedBy?.(openId)}
              layoutId={animateLayout ? sharedId(group, "surface", openId) : undefined}
              className={className}
              transition={{ ...ui }}
              initial={animateLayout ? undefined : { opacity: 0, scale: calm ? 1 : 0.98 }}
              animate={animateLayout ? undefined : { opacity: 1, scale: 1 }}
              exit={animateLayout ? undefined : { opacity: 0, scale: calm ? 1 : 0.98 }}
            >
              {/* layout="position": the surface above is a layoutId morph, so
                  during the tile -> dialog size change this wrapper would
                  otherwise be scale-stretched and the text would visibly
                  distort mid-flight. Position-only layout keeps the content
                  moving with the morph but never squashed. */}
              <motion.div
                layout={animateLayout ? "position" : undefined}
                transition={{ ...ui }}
                className={contentClassName}
              >
                {typeof children === "function" ? children({ id: openId }) : children}
              </motion.div>
            </motion.div>
          </div>
        </CardIdContext.Provider>
      )}
    </AnimatePresence>
  )
}

/**
 * ==============   ExpandCardBody   ================
 */

export interface ExpandCardBodyProps {
  /** The dialog's non-shared detail content. */
  children?: ReactNode
  /** Merged onto the wrapper. */
  className?: string
}

/**
 * The dialog's non-shared body region. It cross-fades in AFTER the surface
 * morph settles (delayed by the snap transition's own duration) so the detail
 * text never appears while the box is still resizing. Under "calm" it fades in
 * without travel; under "still" it appears instantly.
 */
export function ExpandCardBody({ children, className }: ExpandCardBodyProps) {
  const { still, calm, snap } = useExpandCardsContext()
  const theme = useMotionUITheme()
  return (
    <motion.div
      className={className}
      initial={still ? false : { opacity: 0, transform: `translateY(${calm ? 0 : theme.travel.hover}px)` }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={
        still ? { duration: 0 } : { ...snap, delay: calm ? 0 : snap.duration }
      }
    >
      {children}
    </motion.div>
  )
}
