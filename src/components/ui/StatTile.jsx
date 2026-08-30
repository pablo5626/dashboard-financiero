import styles from './StatTile.module.css'

export default function StatTile({ label, value, delta, deltaGood }) {
  return (
    <div className={styles.tile}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {delta && (
        <span className={`${styles.delta} ${deltaGood ? styles.good : styles.bad}`}>{delta}</span>
      )}
    </div>
  )
}
