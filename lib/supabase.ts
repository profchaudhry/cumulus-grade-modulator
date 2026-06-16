import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL 
  ?? 'https://pawvmxomfeptgmscprch.supabase.co'

const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY 
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhd3ZteG9tZmVwdGdtc2NwcmNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MDE1ODQsImV4cCI6MjA5NzE3NzU4NH0.rsm3rbiHMl8StSs5MSKZkM7WdsWIXEnZpeB0HjP8TRA'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
