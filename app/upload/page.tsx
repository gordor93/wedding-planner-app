'use client'

import { useState } from 'react'

interface CategoryCard {
  id: string
  title: string
  description: string
  icon: string
  color: string
}

export default function UploadPage() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [isUploading, setIsUploading] = useState(false)

  const categories: CategoryCard[] = [
    { id: 'entertainment', title: 'DJ & Entertainment', description: 'Accepts PDF documents', icon: '🎵', color: 'border-purple-200 hover:border-purple-400 bg-purple-50/30' },
    { id: 'decor', title: 'Florist & Decor', description: 'Accepts PDF documents', icon: '💐', color: 'border-rose-200 hover:border-rose-400 bg-rose-50/30' },
    { id: 'catering', title: 'Catering & Food', description: 'Accepts PDF documents', icon: '🍽️', color: 'border-amber-200 hover:border-amber-400 bg-amber-50/30' },
    { id: 'venue', title: 'Venue Contract', description: 'Accepts PDF documents', icon: '🏰', color: 'border-emerald-200 hover:border-emerald-400 bg-emerald-50/30' },
    { id: 'media', title: 'Photography & Video', description: 'Accepts PDF documents', icon: '📷', color: 'border-indigo-200 hover:border-indigo-400 bg-indigo-50/30' },
  ]

  const handleContractUpload = async (e: React.ChangeEvent<HTMLInputElement>, categoryId: string) => {
    if (!e.target.files || e.target.files.length === 0) return

    const selectedFile = e.target.files[0]
    setIsUploading(true)
    setActiveCategory(categoryId)
    setStatus(`Scraping text from ${selectedFile.name}...`)

    const formData = new FormData()
    formData.append('contract', selectedFile)
    formData.append('vendorType', categoryId)

    try {
      // 1. Upload file and extract raw text into the Bronze table
      const response = await fetch('/api/parse-contract', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (response.ok) {
        const parserLabel =
          result.extractionMethod === 'gemini'
            ? 'Gemini (scan or screenshot PDF)'
            : 'local PDF text extraction'
        setStatus(`✅ Saved to Bronze via ${parserLabel}! Processing data into structured Silver tables now...`)
    
        // 2. Instantly pass the new Bronze ID to your fresh process-silver folder API route!
        const silverResponse = await fetch('/api/process-silver', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            payloadId: result.id,
            weddingId: null 
          }),
        })
    
        const silverResult = await silverResponse.json()
    
        if (silverResponse.ok) {
          setStatus(`✅ Done! Extracted "${silverResult.vendor.company_name}" directly into your Silver Vendors table!`)
        } else {
          setStatus(`⚠️ Saved raw text to Bronze, but Silver parsing failed: ${silverResult.error}`)
        }
      } else {
        setStatus(`❌ Processing runtime error: ${result.error || 'Failed to parse.'}`)
      }
    } catch (err) {
      setStatus('❌ Network connectivity error uploading contract to server.')
    } finally {
      setIsUploading(false)
      setActiveCategory(null)
      e.target.value = '' // Clear input so file can be test-uploaded again if needed
    }
  }

  return (
    <div className="min-h-screen bg-gray-50/50 p-8 sm:p-12">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Vendor Contracts Ingestion</h1>
          <p className="mt-1 text-sm text-gray-500">
            Select a dedicated category below to upload and parse your unstructured contract data files directly into your Bronze data layer.
          </p>
        </div>

        {status && (
          <div className={`rounded-xl border p-4 text-sm font-semibold shadow-sm ${status.startsWith('✅') ? 'bg-green-50 border-green-200 text-green-800' : status.startsWith('❌') ? 'bg-red-50 border-red-200 text-red-800' : 'bg-blue-50 border-blue-200 text-blue-800 animate-pulse'}`}>
            {status}
          </div>
        )}

        {/* Dynamic Category Card Grid System */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className={`group flex flex-col justify-between rounded-2xl border bg-white p-6 shadow-sm transition-all duration-200 hover:shadow-md ${cat.color} ${isUploading && activeCategory !== cat.id ? 'opacity-40 pointer-events-none' : ''}`}
            >
              <div className="space-y-4">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white text-2xl shadow-sm border border-gray-100">
                  {cat.icon}
                </span>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">{cat.title}</h3>
                  <p className="mt-1 text-xs text-gray-400">{cat.description}</p>
                </div>
              </div>

              <div className="mt-8 relative">
                <input
                  type="file"
                  accept=".pdf"
                  disabled={isUploading}
                  onChange={(e) => handleContractUpload(e, cat.id)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                />
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow transition group-hover:bg-slate-800"
                >
                  {isUploading && activeCategory === cat.id ? 'Parsing Document...' : 'Upload Contract'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
