import { createContext, useContext, useState } from 'react'

const PeriodContext = createContext(null)

export function PeriodProvider({ children }) {
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)

  const setPeriod = (year, month) => {
    setSelectedYear(year)
    setSelectedMonth(month)
  }

  return (
    <PeriodContext.Provider value={{ selectedYear, selectedMonth, setPeriod }}>
      {children}
    </PeriodContext.Provider>
  )
}

export function usePeriod() {
  const context = useContext(PeriodContext)
  if (!context) {
    throw new Error('usePeriod must be used within a PeriodProvider')
  }
  return context
}