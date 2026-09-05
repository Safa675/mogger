import postgres, { type Sql } from 'postgres'
import { databaseUrl } from './env'

let sql: Sql | null = null

export function getSql(): Sql {
  if (!sql) {
    const url = databaseUrl()
    const local = /localhost|127\.0\.0\.1/.test(url)
    sql = postgres(url, {
      max: 1,
      ssl: local ? false : true,
    })
  }
  return sql
}
