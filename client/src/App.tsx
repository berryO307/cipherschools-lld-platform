import { Route, Routes } from 'react-router-dom'
import { Dashboard } from '@/pages/Dashboard'
import { Workspace } from '@/pages/Workspace'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/practice/:problemId" element={<Workspace />} />
    </Routes>
  )
}

export default App
