import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import Home from "./pages/Home"
import CreateGroup from "./pages/CreateGroup"
import JoinGroup from "./pages/JoinGroup"
import GroupDetail from "./pages/GroupDetail"
import Header from "./components/ui/Header"
import { UserProvider } from "@/components/common/UserContext"

function App() {
  return (
    <UserProvider>
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-indigo-900 to-purple-900 text-white">
        <Router>
          <Header />
          <main className="flex-grow flex items-center justify-center px-4">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/create" element={<CreateGroup />} />
              <Route path="/join" element={<JoinGroup />} />
              <Route path="/group/:address" element={<GroupDetail />} />
            </Routes>
          </main>
        </Router>
      </div>
    </UserProvider>
  )
}

export default App
