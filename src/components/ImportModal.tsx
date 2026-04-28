import React, { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Content, ContentType } from '../data/content';

export function ImportModal({ 
  onClose, 
  onImport 
}: { 
  onClose: () => void;
  onImport: (content: Content) => void;
}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [type, setType] = useState<ContentType>('story');
  const [mediaUrl, setMediaUrl] = useState('');

  const handleImport = () => {
    if (!title.trim() || !text.trim()) return;

    const newContent: Content = {
      id: `custom-${Date.now()}`,
      title: title.trim(),
      description: 'Imported custom content.',
      type,
      text: text.trim(),
      mediaUrl: mediaUrl.trim() || undefined
    };
    
    onImport(newContent);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
          <h2 className="text-xl font-bold">Import Custom Content</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input 
                  type="text" 
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  placeholder="e.g. My Favorite Story"
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={type}
                  onChange={e => setType(e.target.value as ContentType)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                >
                  <option value="story">Story</option>
                  <option value="video">Video</option>
                  <option value="music">Music</option>
                </select>
              </div>
            </div>

            {(type === 'video' || type === 'music') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Media / YouTube URL (Optional)</label>
                <input 
                  type="url" 
                  value={mediaUrl}
                  onChange={e => setMediaUrl(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Japanese Text (Transcript)</label>
              <textarea 
                value={text}
                onChange={e => setText(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl h-64 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all resize-none font-sans"
                placeholder="Paste Japanese text here..."
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-5 py-2 font-medium text-gray-600 hover:bg-gray-200 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleImport}
            disabled={!title.trim() || !text.trim()}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
          >
            Import & Analyze
          </button>
        </div>
      </div>
    </div>
  );
}
