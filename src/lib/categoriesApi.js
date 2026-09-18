import { supabase } from './supabaseClient.js'

export async function listCategories() {
  const { data, error } = await supabase.from('categories').select('*').eq('is_active', true).order('name')
  if (error) throw error
  return data
}

export async function createCategory({ name, emoji, color, isAmbiguous = true, monthlyBudget = null }) {
  const { data, error } = await supabase
    .from('categories')
    .insert({
      name, emoji: emoji || null, color: color || null, is_ambiguous: isAmbiguous,
      monthly_budget: monthlyBudget != null && monthlyBudget !== '' ? Number(monthlyBudget) : null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCategory(id, fields) {
  const { error } = await supabase.from('categories').update(fields).eq('id', id)
  if (error) throw error
}

export async function archiveCategory(id) {
  const { error } = await supabase.from('categories').update({ is_active: false }).eq('id', id)
  if (error) throw error
}
