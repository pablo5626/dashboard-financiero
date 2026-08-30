import styles from './Card.module.css'

export default function Card({ title, action, children, className = '', style }) {
  return (
    <section className={`${styles.card} ${className}`} style={style}>
      {(title || action) && (
        <header className={styles.header}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}
