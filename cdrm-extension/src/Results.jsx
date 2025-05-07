import React, { useEffect, useState } from 'react';

function Results({ onCloseComplete, result }) {
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    // Trigger slide down on mount
    const timeout = setTimeout(() => setAnimateIn(true), 10);
    return () => clearTimeout(timeout);
  }, []);

  const handleClose = () => {
    // Trigger slide up
    setAnimateIn(false);
    setTimeout(() => {
      onCloseComplete(); // Tell parent to unmount
    }, 500); // Match duration-500
  };

  return (
    <div
      className={`overflow-y-auto fixed inset-0 bg-black bg-opacity-90 z-50 flex justify-center items-start transition-transform duration-500 transform ${
        animateIn ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      <div className="mt-20 bg-gray-800 text-white p-6 rounded-lg shadow-lg w-11/12 max-w-xl flex flex-col overflow-y-auto">
      <p className='h-64 text-center'>{result}</p>
      <div className='flex flex-row justify-around'>
      <button
          className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded mb-4 h-12 w-40"
          onClick={handleClose}
        >
          Close
        </button>
      <button className='bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded mb-b h-12 w-40'>Copy</button>
      </div>

      </div>
    </div>
  );
}

export default Results;
