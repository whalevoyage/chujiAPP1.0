import type { Course, PlanStep, Task } from '../../api'

export type ScheduleItem =
  | { kind: 'step'; step: PlanStep; title: string; time: string; subtitle: string; status: string }
  | { kind: 'course'; course: Course; title: string; time: string; subtitle: string }
  | { kind: 'task'; task: Task; title: string; time: string; subtitle: string; checkedIn: boolean }
