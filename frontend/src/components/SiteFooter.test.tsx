import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SiteFooter from './SiteFooter'

describe('SiteFooter 站点底部', () => {
  it('渲染站点介绍', () => {
    render(<SiteFooter />)
    expect(screen.getByText(/瓦特的自研室/)).toBeInTheDocument()
  })

  it('渲染版权信息', () => {
    render(<SiteFooter />)
    expect(screen.getByText(/© 2026 water\.wang/)).toBeInTheDocument()
  })

  it('ICP 备案号指向工信部且新标签页打开', () => {
    render(<SiteFooter />)
    const icp = screen.getByRole('link', { name: /蜀ICP备2023032311号/ })
    expect(icp).toHaveAttribute('href', 'https://beian.miit.gov.cn/#/Integrated/index')
    expect(icp).toHaveAttribute('target', '_blank')
    expect(icp).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
