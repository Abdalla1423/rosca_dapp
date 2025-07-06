import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { GroupProvider } from "@/context/GroupContext"

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GroupProvider>
      <App />
    </GroupProvider>
  </React.StrictMode>,
)

