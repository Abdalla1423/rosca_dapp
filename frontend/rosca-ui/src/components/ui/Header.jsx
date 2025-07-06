import { Coins } from "lucide-react"
import { Link } from "react-router-dom"

export default function Header() {
  return (
    <header className="w-full bg-indigo-950/80 backdrop-blur-sm shadow-sm">
      <div className="max-w-screen-xl mx-auto flex justify-center items-center py-4 px-4">
        <Link
          to="/"
          className="flex items-center gap-2 text-white hover:text-indigo-300 transition"
        >
          <Coins className="w-6 h-6 text-indigo-300" />
          <span className="text-2xl font-bold tracking-wide">ROSCA</span>
        </Link>
      </div>
    </header>
  )
}
