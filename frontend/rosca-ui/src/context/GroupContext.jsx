import { createContext, useContext, useState } from "react"

const GroupContext = createContext()

export const useGroups = () => useContext(GroupContext)

export const GroupProvider = ({ children }) => {
  const [groups, setGroups] = useState([])

  const addGroup = (group) => {
    setGroups((prev) => [...prev, group])
  }

  return (
    <GroupContext.Provider value={{ groups, addGroup }}>
      {children}
    </GroupContext.Provider>
  )
}
