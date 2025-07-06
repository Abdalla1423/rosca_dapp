import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import { ethers } from "ethers"
import { useEffect, useState, createContext } from "react"

import Home from "./pages/Home"
import CreateGroup from "./pages/CreateGroup"
import JoinGroup from "./pages/JoinGroup"
import Header from "./components/ui/Header"
import GroupDetail from "./pages/GroupDetail" 

// Context to share Ethereum provider & signer
export const Web3Context = createContext(null)

function App() {
  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [account, setAccount] = useState(null)

  useEffect(() => {
    const init = async () => {
      if (window.ethereum) {
        const web3Provider = new ethers.BrowserProvider(window.ethereum)
        const signer = await web3Provider.getSigner()
        const address = await signer.getAddress()

        setProvider(web3Provider)
        setSigner(signer)
        setAccount(address)

        window.ethereum.on("accountsChanged", async () => {
          const newSigner = await web3Provider.getSigner()
          setSigner(newSigner)
          setAccount(await newSigner.getAddress())
        })
      } else {
        console.error("MetaMask not found")
      }
    }

    init()
  }, [])

  return (
    <Web3Context.Provider value={{ provider, signer, account }}>
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
    </Web3Context.Provider>
  )
}

export default App
