import type { WidgetConfig } from '../../../shared/types'
import { closeModal } from '../lib/ui'
import { EventsWidget } from '../widgets/EventsWidget'
import { Modal } from './ui'

/** What the main process sends with `navigate` when a digest notification is clicked (see main/index.ts). */
export const ACTIVITY_TARGET = 'pushback:activity'

const ALL_ACTIVITY: WidgetConfig = { id: 'activity-view', type: 'events', repos: [], options: { unreadOnly: false } }

/** Every recorded event, whatever dashboard is open: what a digest summarised. */
export function ActivityModal() {
  return (
    <Modal title="Activity" onClose={closeModal} width={640}>
      <div className="activity-view">
        <EventsWidget widget={ALL_ACTIVITY} filter="" />
      </div>
    </Modal>
  )
}
