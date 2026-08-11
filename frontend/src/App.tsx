import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import LoginPlaceholder from './pages/LoginPlaceholder'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPlaceholder />} />
    </Routes>
  )
}

export default App
