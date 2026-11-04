import { tasksEndpoints } from '@features/tasks'

export const activeQueues = () => tasksEndpoints.getQueuesActive({ params: {} })
