import { useEffect, useState } from 'react'
import { IconSettings, IconClose, IconChevronRight, IconTag } from './icons.jsx'
import ColorSwatchPicker from './ui/ColorSwatchPicker.jsx'
import ConfirmDialog from './ui/ConfirmDialog.jsx'
import { listCategories, createCategory, updateCategory, archiveCategory } from '../lib/categoriesApi.js'
import { backfillPurposeCategoryStats } from '../lib/transactionsApi.js'
import styles from './SettingsPanel.module.css'

const emptyNewCategory = { name: '', emoji: '', color: '', isAmbiguous: true }
const emptyEditDraft = { name: '', emoji: '', color: '', isAmbiguous: true, monthlyBudget: '' }

// Menú raíz de "Ajustes" — una fila por sección, patrón lista de Ajustes de
// iOS (glifo + título + subtítulo + chevron). Agregar una sección nueva es
// agregar una entrada acá con su propio `key` y un bloque de contenido en
// SETTINGS_SECTIONS más abajo — no se agrega nada a esta lista salvo que el
// usuario pida una sección concreta.
const SETTINGS_SECTIONS = [
  { key: 'categorias', label: 'Categorías', subtitle: 'Crear, renombrar, colores, presupuestos', Icon: IconTag },
]

// Botón + panel de ajustes, montado una sola vez en AppShell y siempre
// visible arriba a la izquierda en cualquier página — pensado para
// configuración que no se necesita todo el tiempo (hoy: categorías, más
// secciones después) y por eso no debe ocupar espacio fijo en ninguna
// página en particular. El panel es una mini-navegación de dos niveles
// (menú de secciones → detalle de una sección con botón "volver"), no un
// único formulario largo, precisamente para que agregar secciones futuras
// no vuelva la pantalla raíz más pesada. Cada página que lista/usa
// categorías (GastosDiarios.jsx, Diario.jsx, QuickCaptureFAB.jsx) sigue
// trayendo su propia copia vía listCategories() al montar/abrir — sin store
// global, mismo patrón que el resto de la app — así que un cambio hecho acá
// se refleja la próxima vez que esa pantalla cargue, no en vivo mientras
// este panel está abierto sobre otra.
export default function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState(null) // null = menú raíz, si no la key de SETTINGS_SECTIONS
  const [categories, setCategories] = useState([])
  const [error, setError] = useState(null)

  const [editingId, setEditingId] = useState('')
  const [editDraft, setEditDraft] = useState(emptyEditDraft)
  const [savingEdit, setSavingEdit] = useState(false)

  const [newCategory, setNewCategory] = useState(emptyNewCategory)
  const [creating, setCreating] = useState(false)

  const [confirmArchive, setConfirmArchive] = useState(null) // { id, name } | null

  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState(null)

  useEffect(() => {
    if (!open) return
    listCategories().then(setCategories).catch((err) => setError(err.message))
  }, [open])

  async function reload() {
    try {
      setCategories(await listCategories())
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(id) {
    setEditingId(id)
    const cat = categories.find((c) => c.id === id)
    setEditDraft({
      name: cat?.name ?? '', emoji: cat?.emoji ?? '', color: cat?.color ?? '',
      isAmbiguous: cat?.is_ambiguous ?? true,
      monthlyBudget: cat?.monthly_budget != null ? String(cat.monthly_budget) : '',
    })
  }

  async function handleSaveEdit() {
    if (!editingId || !editDraft.name.trim()) return
    setSavingEdit(true)
    try {
      await updateCategory(editingId, {
        name: editDraft.name.trim(),
        emoji: editDraft.emoji.trim() || null,
        color: editDraft.color || null,
        is_ambiguous: editDraft.isAmbiguous,
        monthly_budget: editDraft.monthlyBudget === '' ? null : Number(editDraft.monthlyBudget),
      })
      setEditingId('')
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingEdit(false)
    }
  }

  // Emoji obligatorio para categorías nuevas (no retroactivo sobre las que
  // ya existían sin uno) — mismo criterio que tenía GastosDiarios.jsx antes
  // de que esta sección se mudara acá.
  async function handleCreate(e) {
    e.preventDefault()
    if (!newCategory.name.trim() || !newCategory.emoji.trim()) return
    setCreating(true)
    try {
      await createCategory({
        name: newCategory.name.trim(), emoji: newCategory.emoji.trim(),
        color: newCategory.color, isAmbiguous: newCategory.isAmbiguous,
      })
      setNewCategory(emptyNewCategory)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function doArchive() {
    const target = confirmArchive
    setConfirmArchive(null)
    try {
      await archiveCategory(target.id)
      if (editingId === target.id) setEditingId('')
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleBackfill() {
    setBackfilling(true)
    setBackfillResult(null)
    try {
      setBackfillResult(await backfillPurposeCategoryStats())
    } catch (err) {
      setError(err.message)
    } finally {
      setBackfilling(false)
    }
  }

  function close() {
    setOpen(false)
    setSection(null)
    setEditingId('')
    setError(null)
  }

  const activeSection = SETTINGS_SECTIONS.find((s) => s.key === section)

  return (
    <>
      <button type="button" className={styles.trigger} aria-label="Ajustes" onClick={() => setOpen(true)}>
        <IconSettings width={22} height={22} />
      </button>

      {open && (
        <div className={styles.backdrop} onClick={close}>
          <div
            className={styles.panel} role="dialog" aria-modal="true"
            aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.header}>
              {activeSection ? (
                <button type="button" className={styles.backButton} onClick={() => setSection(null)} aria-label="Volver">
                  <IconChevronRight width={20} height={20} style={{ transform: 'rotate(180deg)' }} />
                  <span>Ajustes</span>
                </button>
              ) : (
                <h2 id="settings-title" className={styles.title}>Ajustes</h2>
              )}
              <button type="button" className={styles.closeButton} onClick={close} aria-label="Cerrar">
                <IconClose width={20} height={20} />
              </button>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            {!activeSection && (
              <div className={styles.menuList}>
                {SETTINGS_SECTIONS.map(({ key, label, subtitle, Icon }) => (
                  <button key={key} type="button" className={styles.menuRow} onClick={() => setSection(key)}>
                    <span className={styles.menuGlyph}><Icon width={20} height={20} /></span>
                    <span className={styles.menuText}>
                      <span className={styles.menuLabel}>{label}</span>
                      <span className={styles.menuSubtitle}>{subtitle}</span>
                    </span>
                    <IconChevronRight width={18} height={18} className={styles.menuChevron} />
                  </button>
                ))}
              </div>
            )}

            {activeSection?.key === 'categorias' && (
            <>
            <h3 className={styles.sectionTitle}>Categorías</h3>
            <p className={styles.hint}>
              Creá, renombrá o archivá categorías, y editá su emoji, color y presupuesto mensual.
            </p>

            <div className={styles.list}>
              {categories.map((c) => (
                <div key={c.id} className={styles.row}>
                  {editingId === c.id ? (
                    <div className={styles.editForm}>
                      <input
                        value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                        className={styles.textInput} placeholder="Nombre"
                      />
                      <div className={styles.editFormRow}>
                        <input
                          value={editDraft.emoji} maxLength={4}
                          onChange={(e) => setEditDraft({ ...editDraft, emoji: e.target.value })}
                          className={styles.emojiInput} placeholder="Emoji"
                        />
                        <ColorSwatchPicker value={editDraft.color} onChange={(color) => setEditDraft({ ...editDraft, color })} />
                      </div>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox" checked={editDraft.isAmbiguous}
                          onChange={(e) => setEditDraft({ ...editDraft, isAmbiguous: e.target.checked })}
                        />
                        Ambigua
                      </label>
                      <input
                        type="number" value={editDraft.monthlyBudget}
                        onChange={(e) => setEditDraft({ ...editDraft, monthlyBudget: e.target.value })}
                        className={styles.textInput} placeholder="Presupuesto mensual (opcional)"
                      />
                      {c.name.trim().toLowerCase() === 'préstamo' && (
                        <p className={styles.warning}>
                          Esta categoría alimenta la detección de préstamos en Deudas — cambiarle el nombre o archivarla desactiva esa función.
                        </p>
                      )}
                      <div className={styles.rowActions}>
                        <button type="button" onClick={handleSaveEdit} disabled={savingEdit} className={styles.saveButton}>Guardar</button>
                        <button type="button" onClick={() => setEditingId('')} className={styles.cancelButton}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span
                        className={styles.rowGlyph}
                        style={c.color ? { background: c.color } : undefined}
                      >
                        {c.emoji || c.name.charAt(0).toUpperCase()}
                      </span>
                      <span className={styles.rowName}>{c.name}</span>
                      <button type="button" onClick={() => startEdit(c.id)} className={styles.editLink}>Editar</button>
                      <button type="button" onClick={() => setConfirmArchive({ id: c.id, name: c.name })} className={styles.archiveLink}>Archivar</button>
                    </>
                  )}
                </div>
              ))}
              {categories.length === 0 && <p className={styles.hint}>No hay categorías todavía.</p>}
            </div>

            <form onSubmit={handleCreate} className={styles.createForm}>
              <span className={styles.hint}>+ Nueva categoría</span>
              <input
                placeholder="Nombre" value={newCategory.name}
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                className={styles.textInput}
              />
              <div className={styles.editFormRow}>
                <input
                  placeholder="Emoji (obligatorio)" value={newCategory.emoji} maxLength={4}
                  onChange={(e) => setNewCategory({ ...newCategory, emoji: e.target.value })}
                  className={styles.emojiInput}
                />
                <ColorSwatchPicker value={newCategory.color} onChange={(color) => setNewCategory({ ...newCategory, color })} />
              </div>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox" checked={newCategory.isAmbiguous}
                  onChange={(e) => setNewCategory({ ...newCategory, isAmbiguous: e.target.checked })}
                />
                Ambigua
              </label>
              <button
                type="submit" disabled={creating || !newCategory.name.trim() || !newCategory.emoji.trim()}
                className={styles.saveButton}
              >
                Crear
              </button>
            </form>

            <button type="button" onClick={handleBackfill} disabled={backfilling} className={styles.learnButton}>
              {backfilling ? 'Aprendiendo…' : 'Aprender categoría/tag de tu historial'}
            </button>
            {backfillResult != null && (
              <p className={styles.hint}>
                Se analizaron {backfillResult} movimientos con categoría — las sugerencias en "Agregar movimiento manual" y el "+" ya lo reflejan.
              </p>
            )}
            </>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmArchive}
        title={`¿Archivar la categoría "${confirmArchive?.name}"?`}
        message="Se archiva, no se pierde el historial."
        confirmLabel="Archivar"
        destructive
        onConfirm={doArchive}
        onCancel={() => setConfirmArchive(null)}
      />
    </>
  )
}
