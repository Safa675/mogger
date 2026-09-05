import { app } from './app'

export default {
  fetch: (request: Request) => app.fetch(request),
}
