import { supabase } from './supabaseClient.js'

export async function listCategories() {
  const { data, error } = await supabase.from('categories').select('*').order('name')
  if (error) throw error
  return data
}

export async function updateCategoryBudget(id, monthlyBudget) {
  const { error } = await supabase.from('categories').update({ monthly_budget: monthlyBudget }).eq('id', id)
  if (error) throw error
}
